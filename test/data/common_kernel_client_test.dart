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
            '/v1/kernel/board-summaries' => {
              'boards': [
                {
                  'id': 'a',
                  'title': '활동',
                  'lifecycle': 'active',
                  'revision': 1,
                  'taskCount': 2,
                  'readyTaskCount': 1,
                  'pendingChangeCount': 0,
                  'pendingProposalCount': 0,
                },
              ],
              'nextCursor': null,
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
      expect((await client.listBoardsPage()).boards.single['id'], 'a');
      expect(requests[1], '/v1/kernel/board-summaries?limit=20');
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
        request.response.write('{"boards":"incorrect","nextCursor":null}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await expectLater(
        client.listBoardsPage(),
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

  test('summary page carries encoded cursor and validates its shape', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      expect(request.uri.path, '/v1/kernel/board-summaries');
      expect(request.uri.queryParameters, {'limit': '3', 'cursor': 'a/b'});
      await request.drain<void>();
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'boards': [
            {
              'id': 'z',
              'title': '마지막 활동',
              'lifecycle': 'active',
              'revision': 2,
              'taskCount': 1,
              'readyTaskCount': 1,
              'pendingChangeCount': 0,
              'pendingProposalCount': 0,
            },
          ],
          'nextCursor': 'z',
        }),
      );
      await request.response.close();
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
    );
    final page = await client.listBoardsPage(limit: 3, cursor: 'a/b');
    expect(page.boards.single['taskCount'], 1);
    expect(page.nextCursor, 'z');
  });

  test('non-JSON HTTP failure keeps its status instead of hiding it', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      await request.drain<void>();
      request.response.statusCode = 503;
      request.response.write('<html>unavailable</html>');
      await request.response.close();
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
    );
    await expectLater(
      client.contracts(),
      throwsA(
        isA<CommonKernelException>()
            .having((error) => error.code, 'code', 'HTTP_ERROR')
            .having((error) => error.statusCode, 'status', 503),
      ),
    );
  });

  test('deadline also covers a response that keeps streaming', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      await request.drain<void>();
      request.response.headers.contentType = ContentType.json;
      for (var i = 0; i < 12; i++) {
        try {
          request.response.write(' ');
          await request.response.flush();
        } catch (_) {
          break;
        }
        await Future<void>.delayed(const Duration(milliseconds: 30));
      }
      try {
        await request.response.close();
      } catch (_) {
        // The client closes the connection when its deadline expires.
      }
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
      timeout: const Duration(milliseconds: 130),
    );
    await expectLater(
      client.contracts(),
      throwsA(
        isA<CommonKernelException>().having(
          (error) => error.code,
          'code',
          'NETWORK_TIMEOUT',
        ),
      ),
    );
  });
}
