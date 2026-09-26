import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/features/boards/health_scenario_dialogs.dart';

Future<void> openDialog<T>(
  WidgetTester tester,
  Widget dialog,
  void Function(T?) onResult,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => FilledButton(
            onPressed: () async => onResult(
              await showDialog<T>(context: context, builder: (_) => dialog),
            ),
            child: const Text('열기'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('열기'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('health creation requires an explicit reviewed capture', (
    tester,
  ) async {
    String? result;
    await openDialog<String>(
      tester,
      const HealthScenarioDialog(
        options: [HealthImportOption(importId: 'home', title: '집에서 하는 3단계 홈트')],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('health-create-submit')));
    await tester.pumpAndSettle();
    expect(find.text('운동 화면 하나를 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('health-import-home')));
    await tester.tap(find.byKey(const Key('health-create-submit')));
    await tester.pumpAndSettle();
    expect(result, 'home');
  });

  testWidgets('health confirmation keeps selected steps in source order', (
    tester,
  ) async {
    List<int>? result;
    final opened = <String>[];
    await openDialog<List<int>>(
      tester,
      HealthConfirmDialog(
        title: '집에서 하는 3단계 홈트',
        importId: 'home',
        onOpenImport: opened.add,
        candidates: const [
          {'factIndex': 1, 'text': '제자리 걷기 5분'},
          {'factIndex': 2, 'text': '스쿼트 10회'},
          {'factIndex': 3, 'text': '어깨 돌리기 10회'},
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('health-open-source')));
    expect(opened, ['home']);
    await tester.tap(find.byKey(const Key('health-fact-2')));
    await tester.tap(find.byKey(const Key('health-confirm-submit')));
    await tester.pumpAndSettle();
    expect(result, [1, 3]);
  });

  testWidgets('done exercise requires actual amount; skipped does not', (
    tester,
  ) async {
    List<Map<String, Object?>>? result;
    await openDialog<List<Map<String, Object?>>>(
      tester,
      const HealthOutcomeDialog(
        exercises: [
          {'id': 'step-1', 'text': '제자리 걷기 5분'},
          {'id': 'step-2', 'text': '스쿼트 10회'},
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('health-status-step-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('했어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('health-status-step-2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('하지 않았어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('health-outcome-submit')));
    await tester.pumpAndSettle();
    expect(find.text('실제로 한 운동의 수행량을 확인해 주세요.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('health-amount-step-1')), '4');
    await tester.tap(find.byKey(const Key('health-outcome-submit')));
    await tester.pumpAndSettle();
    expect(result, [
      {
        'exerciseId': 'step-1',
        'status': 'done',
        'actualAmount': 4,
        'actualUnit': 'minutes',
      },
      {'exerciseId': 'step-2', 'status': 'skipped'},
    ]);
  });
}
