import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/features/boards/life_tip_scenario_dialogs.dart';

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
  testWidgets('life-tip creation requires an explicit source choice', (
    tester,
  ) async {
    String? result;
    await openDialog<String>(
      tester,
      const LifeTipScenarioDialog(
        options: [LifeTipImportOption(importId: 'tip-a', title: '영수증 정리 3단계')],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('life-tip-create-submit')));
    await tester.pumpAndSettle();
    expect(find.text('생활 꿀팁 하나를 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('life-tip-import-tip-a')));
    await tester.tap(find.byKey(const Key('life-tip-create-submit')));
    await tester.pumpAndSettle();
    expect(result, 'tip-a');
  });

  testWidgets('user can choose a subset while keeping source order', (
    tester,
  ) async {
    List<int>? result;
    final opened = <String>[];
    await openDialog<List<int>>(
      tester,
      LifeTipConfirmDialog(
        title: '영수증 정리 3단계',
        importId: 'tip-a',
        onOpenImport: opened.add,
        candidates: [
          for (var index = 1; index <= 3; index++)
            {
              'factIndex': index,
              'text': '$index 단계',
              'evidenceIds': ['e$index'],
            },
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('life-tip-open-source')));
    expect(opened, ['tip-a']);
    await tester.tap(find.byKey(const Key('life-tip-fact-2')));
    await tester.tap(find.byKey(const Key('life-tip-confirm-submit')));
    await tester.pumpAndSettle();
    expect(result, [1, 3]);
  });

  testWidgets('outcomes require a status for every confirmed action', (
    tester,
  ) async {
    List<Map<String, Object?>>? result;
    await openDialog<List<Map<String, Object?>>>(
      tester,
      const LifeTipOutcomeDialog(
        actions: [
          {'id': 'a1', 'text': '영수증 모으기'},
          {'id': 'a2', 'text': '영수증 분류하기'},
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('life-tip-outcome-submit')));
    await tester.pumpAndSettle();
    expect(find.text('모든 단계의 실행 결과를 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('life-tip-outcome-a1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('했어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('life-tip-outcome-a2')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('하지 않았어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('life-tip-outcome-submit')));
    await tester.pumpAndSettle();
    expect(result, [
      {'actionId': 'a1', 'status': 'done'},
      {'actionId': 'a2', 'status': 'skipped'},
    ]);
  });
}
