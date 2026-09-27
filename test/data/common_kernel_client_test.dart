import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';

void main() {
  test(
    'shopping correction reads encoded activity and posts stable choice',
    () async {
      final paths = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        paths.add('${request.method} ${request.uri}');
        if (request.method == 'POST') {
          bodies.add(
            jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>,
          );
        } else {
          await request.drain<void>();
        }
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          request.method == 'GET'
              ? '{"activityId":"shop/a","choice":{}}'
              : '{"choiceId":"choice-b"}',
        );
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      expect(
        (await client.getEditableShoppingChoice('shop/a'))['activityId'],
        'shop/a',
      );
      final request = <String, Object?>{
        'commandId': 'correct-1',
        'activityId': 'shop/a',
        'expectedGraphFingerprint': 'c' * 64,
        'selectedImportId': 'item-b',
        'quantity': 3,
        'confirmed': true,
      };
      expect(
        (await client.correctShoppingChoice(request))['choiceId'],
        'choice-b',
      );
      expect(paths, [
        'GET /v1/kernel/shopping/editable/shop%2Fa',
        'POST /v1/kernel/shopping/corrections',
      ]);
      expect(bodies.single, request);
    },
  );

  test(
    'recipe shopping transfer reviews encoded link and sends stable request',
    () async {
      final paths = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        paths.add('${request.method} ${request.uri}');
        if (request.method == 'POST') {
          bodies.add(
            jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>,
          );
        } else {
          await request.drain<void>();
        }
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          request.method == 'GET'
              ? '{"connectionId":"link/a","successors":[]}'
              : '{"connectionId":"link/b","replayed":false}',
        );
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      expect(
        (await client.getRecipeShoppingTransferReview(
          'link/a',
        ))['connectionId'],
        'link/a',
      );
      final request = <String, Object?>{
        'commandId': 'move-1',
        'connectionId': 'link/a',
        'successorActivityId': 'meal/b',
        'expectedSourceRevision': 4,
        'expectedShoppingRevision': 3,
        'expectedSuccessorRevision': 5,
        'expectedSourceResultId': 'result-2',
        'confirmed': true,
      };
      expect(
        (await client.transferRecipeShoppingConnection(
          request,
        ))['connectionId'],
        'link/b',
      );
      expect(paths, [
        'GET /v1/kernel/scenario-connections/transfer-review/link%2Fa',
        'POST /v1/kernel/scenario-connections/transfer',
      ]);
      expect(bodies.single, request);
    },
  );

  test('recipe shopping review and proposal use stable encoded ids', () async {
    final requests = <String>[];
    final bodies = <Map<String, dynamic>>[];
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      requests.add('${request.method} ${request.uri}');
      if (request.method == 'POST') {
        bodies.add(
          jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>,
        );
      } else {
        await request.drain<void>();
      }
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        request.method == 'GET'
            ? '{"expectedRevision":3,"changes":[]}'
            : '{"proposalId":"proposal-1"}',
      );
      await request.response.close();
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
    );
    expect(
      (await client.getRecipeShoppingPlanReview(
        'shop/a',
        'link/b',
      ))['expectedRevision'],
      3,
    );
    final proposal = <String, Object?>{
      'commandId': 'plan-1',
      'shoppingActivityId': 'shop/a',
      'connectionId': 'link/b',
      'expectedRevision': 3,
      'expectedSourceResultId': 'needs-1',
      'confirmed': true,
    };
    expect(
      (await client.proposeRecipeShoppingPlan(proposal))['proposalId'],
      'proposal-1',
    );
    expect(requests, [
      'GET /v1/kernel/shopping/recipe-needs/review/shop%2Fa/link%2Fb',
      'POST /v1/kernel/shopping/recipe-needs/proposals',
    ]);
    expect(bodies.single, proposal);
  });

  test(
    'recipe correction sends the whole replacement and encoded activity id',
    () async {
      final requests = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        requests.add('${request.method} ${request.uri}');
        if (request.method == 'POST') {
          bodies.add(
            jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>,
          );
        } else {
          await request.drain<void>();
        }
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode(
            request.method == 'GET'
                ? {
                    'activityId': 'meal/a',
                    'assertionId': 'confirmed-1',
                    'recipe': <String, Object?>{},
                  }
                : {'activityId': 'meal/a', 'revision': 2},
          ),
        );
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      expect(
        (await client.getEditableRecipe('meal/a'))['assertionId'],
        'confirmed-1',
      );
      final correction = <String, Object?>{
        'commandId': 'recipe-fix-1',
        'activityId': 'meal/a',
        'expectedAssertionId': 'confirmed-1',
        'recipe': <String, Object?>{
          'title': '수정한 요리',
          'baseServings': 2,
          'ingredients': <Object>[],
          'steps': <Object>[],
        },
        'confirmed': true,
      };
      expect((await client.correctRecipe(correction))['revision'], 2);
      expect(requests, [
        'GET /v1/kernel/recipe/editable/meal%2Fa',
        'POST /v1/kernel/recipe/corrections',
      ]);
      expect(bodies.single, correction);
    },
  );

  test(
    'capture correction uses an encoded import id and sends the confirmed field',
    () async {
      final requests = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        requests.add('${request.method} ${request.uri}');
        if (request.method == 'POST') {
          bodies.add(
            jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>,
          );
        } else {
          await request.drain<void>();
        }
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode(
            request.method == 'GET'
                ? {'importId': 'a/b', 'fields': <Object>[]}
                : {'importId': 'a/b', 'revision': 2},
          ),
        );
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      expect((await client.getEditableCaptureFields('a/b'))['fields'], isEmpty);
      final correction = {
        'commandId': 'fix-1',
        'importId': 'a/b',
        'path': '/place/name',
        'value': '새 이름',
        'expectedRevision': 1,
        'confirmed': true,
      };
      expect((await client.correctImportedField(correction))['revision'], 2);
      expect(requests, [
        'GET /v1/kernel/ingestion/editable-fields/a%2Fb',
        'POST /v1/kernel/ingestion/field-corrections',
      ]);
      expect(bodies.single, correction);
    },
  );

  test(
    'recipe create intent survives a new file-store instance until cleared',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'luffi-recipe-intent-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final first = FileRecipeScenarioIntentStore(
        directoryPath: directory.path,
      );
      final request = <String, Object?>{
        'commandId': 'stable-create',
        'activityId': 'board-1',
        'confirmed': true,
        'recipe': {'id': 'recipe-1'},
      };
      await first.save(request);
      final reopened = FileRecipeScenarioIntentStore(
        directoryPath: directory.path,
      );
      expect(await reopened.load(), request);
      await reopened.clear();
      expect(await first.load(), isNull);
    },
  );

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
    'recipe creation, proposal acceptance and task commands preserve stable ids without client owner',
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
      await client.createRecipeScenario({
        'commandId': 'recipe-create',
        'activityId': 'recipe-board',
        'confirmed': true,
        'recipe': {'id': 'recipe-a'},
        'targetServings': 4,
        'inventory': <Object?>[],
      });
      await client.acceptProposal(
        proposalId: 'proposal-a',
        commandId: 'accept-a',
      );
      await client.runTask(
        activityId: 'a',
        taskId: 'task-Y',
        expectedRevision: 8,
        commandId: 'stable-2',
      );
      expect(paths, [
        '/v1/kernel/activities/commands',
        '/v1/kernel/recipe/scenarios',
        '/v1/kernel/planning/accept',
        '/v1/kernel/activities/run-task',
      ]);
      expect(bodies[0]['payload']['taskId'], 'task-Z');
      expect(bodies[1]['confirmed'], true);
      expect(bodies[2], {'proposalId': 'proposal-a', 'commandId': 'accept-a'});
      expect(bodies[3], {
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
