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
  int reads = 0;
  KernelJson contract = {
    'packs': [
      {'id': 'recipe', 'version': 1},
    ],
    'capabilities': [
      {'id': 'user.action', 'actor': 'user', 'effect': 'none'},
    ],
  };
  @override
  Future<KernelJson> contracts() async => contract;
  @override
  Future<List<KernelJson>> listBoards() async => [board];
  @override
  Future<KernelJson> getBoard(String activityId) async {
    reads += 1;
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
    expect(find.textContaining('다른 변경이 먼저 반영됐어요'), findsOneWidget);
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
