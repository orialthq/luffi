import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';

void main() {
  test(
    'uses bearer auth and reads contracts, list and encoded stable board id',
    () async {
      final requests = <String>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        expect(
          request.headers.value(HttpHeaders.authorizationHeader),
          'Bearer development-token',
        );
        requests.add(request.uri.toString());
        await request.drain<void>();
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode(switch (request.uri.path) {
            '/v1/kernel/contracts' => {'kernelVersion': 1, 'capabilities': []},
            '/v1/kernel/boards' => {
              'boards': [
                {'id': 'a'},
              ],
            },
            _ => {'id': 'a/b', 'revision': 4},
          }),
        );
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      expect((await client.contracts())['kernelVersion'], 1);
      expect((await client.listBoards()).single['id'], 'a');
      expect((await client.getBoard('a/b'))['id'], 'a/b');
      expect(requests.last, '/v1/kernel/boards/a%2Fb');
    },
  );

  test(
    'command and run task preserve task id, revision and idempotency key without client owner',
    () async {
      final bodies = <Map<String, dynamic>>[];
      final paths = <String>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        paths.add(request.uri.path);
        bodies.add(
          jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>,
        );
        request.response.headers.contentType = ContentType.json;
        request.response.write('{"revision":8}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await client.command({
        'commandId': 'stable-1',
        'activityId': 'a',
        'expectedRevision': 7,
        'type': 'task.transition',
        'payload': {'taskId': 'task-Z', 'to': 'completed'},
      });
      await client.runTask(
        activityId: 'a',
        taskId: 'task-Y',
        expectedRevision: 8,
        commandId: 'stable-2',
      );
      expect(paths, [
        '/v1/kernel/activities/commands',
        '/v1/kernel/activities/run-task',
      ]);
      expect(bodies[0]['payload']['taskId'], 'task-Z');
      expect(bodies[1], {
        'activityId': 'a',
        'taskId': 'task-Y',
        'expectedRevision': 8,
        'commandId': 'stable-2',
      });
      expect(bodies.every((body) => !body.containsKey('ownerId')), isTrue);
    },
  );

  test('maps revision conflicts to a typed refreshable error', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      await request.drain<void>();
      request.response.statusCode = 409;
      request.response.write(
        '{"error":{"code":"REVISION_CONFLICT","message":"changed"}}',
      );
      await request.response.close();
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
    );
    await expectLater(
      client.getBoard('a'),
      throwsA(
        isA<CommonKernelException>()
            .having((e) => e.isRevisionConflict, 'revision conflict', isTrue)
            .having((e) => e.statusCode, 'status', 409),
      ),
    );
  });

  test(
    'missing token fails locally and malformed response is rejected',
    () async {
      await expectLater(
        const HttpCommonKernelClient(token: '').contracts(),
        throwsA(
          isA<CommonKernelException>().having(
            (e) => e.code,
            'code',
            'DEVELOPMENT_ONLY',
          ),
        ),
      );
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        await request.drain<void>();
        request.response.write('{"boards":"incorrect"}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await expectLater(
        client.listBoards(),
        throwsA(
          isA<CommonKernelException>().having(
            (e) => e.code,
            'code',
            'INVALID_RESPONSE',
          ),
        ),
      );
    },
  );

  test('command ids are distinct and safe to send as stable keys', () {
    final ids = List.generate(30, (_) => newKernelCommandId());
    expect(ids.toSet().length, 30);
    expect(ids.every((id) => RegExp(r'^[a-f0-9]{32}$').hasMatch(id)), isTrue);
  });
}
