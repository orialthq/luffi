import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/common_boards_screen.dart';

KernelJson _board() => {
  'id': 'activity-1',
  'title': '토요일 준비',
  'goal': {'description': '저장한 정보로 외출 준비'},
  'revision': 7,
  'lifecycle': 'active',
  'nextActions': ['task-Z'],
  'tasks': [
    {
      'id': 'task-Z',
      'title': '먼저 할 일',
      'revision': 2,
      'kind': 'action',
      'capabilityId': 'user.action',
      'executionStatus': 'not_started',
      'rendererKey': 'future.unknown',
      'evidenceBindings': ['evidence-42'],
      'readiness': {'status': 'ready', 'inputs': {}, 'reasons': []},
    },
    {
      'id': 'task-A',
      'title': '조건을 기다리는 일',
      'revision': 1,
      'kind': 'action',
      'capabilityId': 'user.action',
      'executionStatus': 'not_started',
      'readiness': {
        'status': 'blocked',
        'reasons': ['예약 결과를 기다리고 있어요.'],
      },
    },
  ],
  'pendingChanges': [
    {
      'eventIds': ['event-9'],
      'timeDue': false,
    },
  ],
  'artifacts': [],
  'results': [],
  'reminders': [],
};

final class FakeKernelClient implements CommonKernelClient {
  KernelJson board = _board();
  final commands = <KernelJson>[];
  final runs = <KernelJson>[];
  bool conflict = false;
  bool commitThenTimeout = false;
  bool failContracts = false;
  bool failRead = false;
  bool failNextPage = false;
  int reads = 0;
  final pageRequests = <String?>[];
  List<KernelJson>? extraBoards;
  KernelJson contract = {
    'packs': [
      {'id': 'recipe', 'version': 1},
    ],
    'capabilities': [
      {'id': 'user.action', 'actor': 'user', 'effect': 'none'},
    ],
  };
  @override
  Future<KernelJson> contracts() async {
    if (failContracts) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '계약 연결 실패');
    }
    return contract;
  }

  @override
  Future<KernelBoardPage> listBoardsPage({
    int limit = 20,
    String? cursor,
  }) async {
    pageRequests.add(cursor);
    if (cursor != null && failNextPage) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '목록 연결 실패');
    }
    final summary = <String, Object?>{
      'id': board['id'],
      'title': board['title'],
      'goal': board['goal'],
      'lifecycle': board['lifecycle'],
      'revision': board['revision'],
      'taskCount': (board['tasks'] as List).length,
      'readyTaskCount': 1,
      'pendingChangeCount': 0,
      'pendingProposalCount': 0,
    };
    if (extraBoards == null) {
      return KernelBoardPage(boards: [summary], nextCursor: null);
    }
    return cursor == null
        ? KernelBoardPage(boards: [summary], nextCursor: 'next-id')
        : KernelBoardPage(boards: extraBoards!, nextCursor: null);
  }

  @override
  Future<KernelJson> getBoard(String activityId) async {
    reads += 1;
    if (failRead) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '보드 연결 실패');
    }
    return Map<String, Object?>.from(jsonDecode(jsonEncode(board)) as Map);
  }

  @override
  Future<KernelJson> command(KernelJson command) async {
    commands.add(command);
    if (conflict) {
      throw const CommonKernelException(
        'REVISION_CONFLICT',
        'changed',
        statusCode: 409,
      );
    }
    if (command['type'] == 'activity.create') {
      final payload = command['payload']! as Map;
      board = {
        'id': command['activityId'],
        'title': payload['title'],
        'goal': payload['goal'],
        'revision': 1,
        'lifecycle': 'active',
        'tasks': [],
        'nextActions': [],
      };
    } else {
      final payload = command['payload']! as Map;
      final task = (board['tasks']! as List).cast<Map>().firstWhere(
        (task) => task['id'] == payload['taskId'],
      );
      task['executionStatus'] = payload['to'];
      board['revision'] = (board['revision']! as int) + 1;
    }
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {'revision': board['revision']};
  }

  @override
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  }) async {
    runs.add({
      'activityId': activityId,
      'taskId': taskId,
      'expectedRevision': expectedRevision,
      'commandId': commandId,
    });
    return {};
  }
}

Future<void> _pump(WidgetTester tester, FakeKernelClient client) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: CommonBoardScreen(
        client: client,
        activityId: 'activity-1',
        contracts: client.contract,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'renders goal, next actions, evidence and pending changes with safe unknown renderer',
    (tester) async {
      final client = FakeKernelClient();
      await _pump(tester, client);
      expect(find.text('저장한 정보로 외출 준비'), findsOneWidget);
      expect(find.textContaining('진행 중 · 버전 7'), findsOneWidget);
      expect(find.text('• 먼저 할 일'), findsOneWidget);
      expect(find.text('근거 ID: evidence-42'), findsOneWidget);
      expect(find.text('일반 요약으로 표시 · future.unknown'), findsOneWidget);
      expect(find.byKey(const Key('kernel-pending-changes')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sends stable task id and current revisions instead of card position',
    (tester) async {
      final client = FakeKernelClient();
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      expect(client.commands.single['activityId'], 'activity-1');
      expect(client.commands.single['expectedRevision'], 7);
      expect(client.commands.single['payload'], {
        'taskId': 'task-Z',
        'expectedTaskRevision': 2,
        'to': 'completed',
      });
      expect(client.commands.single['commandId'], isA<String>());
      final blocked = tester.widget<FilledButton>(
        find.byKey(const Key('kernel-complete-task-A')),
      );
      expect(blocked.onPressed, isNull);
      expect(find.textContaining('진행 중 · 버전 8'), findsOneWidget);
    },
  );

  testWidgets('revision conflict disables writes until explicit refresh', (
    tester,
  ) async {
    final client = FakeKernelClient()..conflict = true;
    await _pump(tester, client);
    await tester.tap(find.byKey(const Key('kernel-start-task-Z')));
    await tester.pumpAndSettle();
    expect(find.textContaining('활동 또는 연결된 정보가 변경됐어요'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
    expect(client.commands.length, 1);
    client.conflict = false;
    client.board['revision'] = 9;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(find.textContaining('진행 중 · 버전 9'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'committed write with lost response requires refresh before retry',
    (tester) async {
      final client = FakeKernelClient()..commitThenTimeout = true;
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-start-task-Z')));
      await tester.pumpAndSettle();
      expect(client.board['revision'], 8);
      expect(client.commands, hasLength(1));
      expect(find.text('응답 시간이 초과됐어요.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('kernel-complete-task-Z')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      expect(client.commands, hasLength(1));
      client.commitThenTimeout = false;
      await tester.tap(find.byKey(const Key('kernel-board-refresh')));
      await tester.pumpAndSettle();
      expect(find.textContaining('버전 8'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('kernel-complete-task-Z')),
            )
            .onPressed,
        isNotNull,
      );
    },
  );

  testWidgets('system calculation calls run-task instead of user completion', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = [
      {'id': 'user.action', 'actor': 'system', 'effect': 'none'},
    ];
    await _pump(tester, client);
    expect(find.byKey(const Key('kernel-complete-task-Z')), findsNothing);
    await tester.tap(find.byKey(const Key('kernel-run-task-Z')));
    await tester.pumpAndSettle();
    expect(client.runs.single['taskId'], 'task-Z');
    expect(client.runs.single['expectedRevision'], 7);
    expect(client.commands, isEmpty);
  });

  testWidgets('list loads contracts and opens an independent common board', (
    tester,
  ) async {
    final client = FakeKernelClient();
    await tester.pumpWidget(
      MaterialApp(home: CommonBoardsScreen(client: client)),
    );
    await tester.pumpAndSettle();
    expect(find.text('등록된 분야 recipe'), findsOneWidget);
    expect(find.textContaining('작업 2개'), findsOneWidget);
    await tester.tap(find.byKey(const Key('kernel-board-activity-1')));
    await tester.pumpAndSettle();
    expect(find.byType(CommonBoardScreen), findsOneWidget);
    expect(client.reads, 1);
  });
  testWidgets(
    'activity creation sends title and goal without changing legacy plans',
    (tester) async {
      final client = FakeKernelClient();
      await tester.pumpWidget(
        MaterialApp(home: CommonBoardsScreen(client: client)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('활동 만들기'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), '새 외출');
      await tester.enterText(find.byType(TextFormField).at(1), '예약한 식당 방문');
      await tester.tap(find.text('만들기'));
      await tester.pumpAndSettle();
      expect(client.commands.single['type'], 'activity.create');
      expect((client.commands.single['payload'] as Map)['goal'], {
        'description': '예약한 식당 방문',
      });
      expect(find.byType(CommonBoardScreen), findsOneWidget);
      expect(find.text('아직 작업이 없는 활동이에요.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('loads a second summary page without duplicating existing ids', (
    tester,
  ) async {
    final client = FakeKernelClient()
      ..extraBoards = [
        {
          'id': 'activity-1',
          'title': 'duplicate',
          'lifecycle': 'active',
          'revision': 7,
          'taskCount': 2,
        },
        {
          'id': 'activity-2',
          'title': '새 활동',
          'lifecycle': 'active',
          'revision': 1,
          'taskCount': 0,
        },
      ];
    await tester.pumpWidget(
      MaterialApp(home: CommonBoardsScreen(client: client)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-list-more')));
    await tester.pumpAndSettle();
    expect(client.pageRequests, [null, 'next-id']);
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    expect(find.byKey(const Key('kernel-board-activity-2')), findsOneWidget);
  });

  testWidgets('failed refresh leaves old board visible but disables writes', (
    tester,
  ) async {
    final client = FakeKernelClient();
    await _pump(tester, client);
    client.failRead = true;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(find.text('보드 연결 실패'), findsOneWidget);
    expect(find.text('저장한 정보로 외출 준비'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
    client.failRead = false;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('unknown capability remains readable without write actions', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = <Object?>[];
    await _pump(tester, client);
    expect(find.textContaining('읽기 전용으로 표시해요'), findsWidgets);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('board summaries remain browsable when contracts fail', (
    tester,
  ) async {
    final client = FakeKernelClient()..failContracts = true;
    await tester.pumpWidget(
      MaterialApp(home: CommonBoardsScreen(client: client)),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    expect(find.textContaining('읽기 전용으로 열려요'), findsOneWidget);
    await tester.tap(find.byKey(const Key('kernel-board-activity-1')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('long activity builds task cards as they enter view', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.board['tasks'] = [
      ...(client.board['tasks']! as List),
      for (var index = 0; index < 40; index++)
        {
          'id': 'task-$index',
          'title': '추가 작업 $index',
          'revision': 1,
          'capabilityId': 'user.action',
          'executionStatus': 'not_started',
          'readiness': {'status': 'blocked', 'reasons': []},
        },
    ];
    await _pump(tester, client);
    final lastTask = find.byKey(const Key('kernel-task-task-39'));
    expect(lastTask, findsNothing);
    await tester.scrollUntilVisible(
      lastTask,
      600,
      maxScrolls: 60,
      scrollable: find.byType(Scrollable).first,
    );
    expect(lastTask, findsOneWidget);
  });

  testWidgets('failed second page can retry without losing first page', (
    tester,
  ) async {
    final client = FakeKernelClient()
      ..extraBoards = [
        {
          'id': 'activity-2',
          'title': '새 활동',
          'lifecycle': 'active',
          'revision': 1,
          'taskCount': 0,
        },
      ]
      ..failNextPage = true;
    await tester.pumpWidget(
      MaterialApp(home: CommonBoardsScreen(client: client)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-list-more')));
    await tester.pumpAndSettle();
    expect(find.text('목록 연결 실패'), findsOneWidget);
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    client.failNextPage = false;
    await tester.tap(find.text('새로고침'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('kernel-board-activity-2')), findsOneWidget);
  });

  testWidgets(
    'manual result dialog validates JSON then submits completion with output',
    (tester) async {
      final client = FakeKernelClient();
      client.contract['capabilities'] = [
        {
          'id': 'user.action',
          'actor': 'user',
          'effect': 'none',
          'outputType': 'user.result',
        },
      ];
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), 'invalid');
      await tester.tap(find.text('완료 기록'));
      await tester.pump();
      expect(find.text('올바른 JSON을 입력해 주세요.'), findsOneWidget);
      expect(client.commands, isEmpty);
      await tester.enterText(find.byType(TextFormField), '{"confirmed":true}');
      await tester.tap(find.text('완료 기록'));
      await tester.pumpAndSettle();
      expect((client.commands.single['payload'] as Map)['output'], {
        'confirmed': true,
      });
      expect(tester.takeException(), isNull);
    },
  );
}
