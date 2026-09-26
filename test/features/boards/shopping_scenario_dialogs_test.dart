import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/features/boards/shopping_scenario_dialogs.dart';

Future<void> openDialog(
  WidgetTester tester,
  Widget dialog,
  void Function(Map<String, Object?>?) onResult,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => FilledButton(
            onPressed: () async => onResult(
              await showDialog<Map<String, Object?>>(
                context: context,
                builder: (_) => dialog,
              ),
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
  testWidgets('shopping creation requires purpose and at least one capture', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingScenarioDialog(
        options: [
          ShoppingImportOption(
            importId: 'a',
            title: '패브릭 수납함',
            displayedPriceText: '12,900원',
          ),
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('shopping-create-submit')));
    await tester.pumpAndSettle();
    expect(find.text('목적과 상품 1~8개를 확인해 주세요.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('shopping-purpose')),
      '수납함 고르기',
    );
    await tester.tap(find.byKey(const Key('shopping-import-a')));
    await tester.tap(find.byKey(const Key('shopping-create-submit')));
    await tester.pumpAndSettle();
    expect(result, {
      'purpose': '수납함 고르기',
      'importIds': ['a'],
    });
  });

  testWidgets('selection keeps original price distinct from the outcome', (
    tester,
  ) async {
    Map<String, Object?>? result;
    final opened = <String>[];
    await openDialog(
      tester,
      ShoppingChoiceDialog(
        onOpenImport: opened.add,
        candidates: const [
          {
            'importId': 'a',
            'title': '패브릭 수납함',
            'displayedPriceText': '12,900원',
            'details': [
              {'label': '색상', 'value': '베이지'},
            ],
          },
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.text('원본 캡처 보기'));
    expect(opened, ['a']);
    await tester.tap(find.byKey(const Key('shopping-choice-a')));
    await tester.tap(find.byKey(const Key('shopping-quantity-plus')));
    await tester.tap(find.byKey(const Key('shopping-choice-submit')));
    await tester.pumpAndSettle();
    expect(result, {'selectedImportId': 'a', 'quantity': 2});
  });

  testWidgets(
    'purchase requires actual paid amount only for purchased status',
    (tester) async {
      Map<String, Object?>? result;
      await openDialog(
        tester,
        const ShoppingOutcomeDialog(
          choice: {
            'title': '패브릭 수납함',
            'quantity': 2,
            'displayedPriceText': '12,900원',
          },
        ),
        (value) => result = value,
      );
      await tester.tap(find.byKey(const Key('shopping-outcome-purchased')));
      await tester.tap(find.byKey(const Key('shopping-outcome-submit')));
      await tester.pumpAndSettle();
      expect(find.text('실제 지불액을 1원 이상으로 입력해 주세요.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('shopping-actual-paid')),
        '13500',
      );
      await tester.tap(find.byKey(const Key('shopping-outcome-submit')));
      await tester.pumpAndSettle();
      expect(result, {'status': 'purchased', 'actualPaidKrw': 13500});
    },
  );
}
