import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/features/boards/shopping_scenario_dialogs.dart';
import 'package:ori_beauty/domain/models.dart';
import 'dart:convert';
import 'dart:io';

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

  testWidgets(
    'old price is visible but only current displayed price can be confirmed',
    (tester) async {
      final analysis = StructuredContentAnalysis.fromJson(
        Map<String, Object?>.from(
          jsonDecode(
                File(
                  'server/test/fixtures/variation_shopping_old_current_price_live_analysis.json',
                ).readAsStringSync(),
              )
              as Map,
        ),
      );
      final option = shoppingImportOptionForAnalysis('ambiguous', analysis)!;
      expect(option.priceFacts, hasLength(2));
      expect(option.priceFacts.first.selectable, isFalse);
      expect(option.priceFacts.last.selectable, isTrue);
      Map<String, Object?>? result;
      await openDialog(
        tester,
        ShoppingScenarioDialog(options: [option]),
        (value) => result = value,
      );
      await tester.enterText(
        find.byKey(const Key('shopping-purpose')),
        '수납함 고르기',
      );
      await tester.tap(find.byKey(const Key('shopping-import-ambiguous')));
      await tester.pumpAndSettle();
      expect(find.text('이전 표시가 19,900원'), findsOneWidget);
      expect(find.text('화면 표시가 12,900원'), findsOneWidget);
      expect(
        tester
            .widget<ListTile>(
              find.byKey(
                const ValueKey('shopping-price-ambiguous-/facts/3/value'),
              ),
            )
            .onTap,
        isNull,
      );
      await tester.tap(find.byKey(const Key('shopping-create-submit')));
      await tester.pumpAndSettle();
      expect(find.text('현재 표시 가격 문구를 확인해 주세요.'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('shopping-price-ambiguous-/facts/4/value')),
      );
      await tester.tap(find.byKey(const Key('shopping-create-submit')));
      await tester.pumpAndSettle();
      expect(result, {
        'purpose': '수납함 고르기',
        'importIds': ['ambiguous'],
        'priceReviews': [
          {'importId': 'ambiguous', 'sourcePath': '/facts/4/value'},
        ],
      });
    },
  );

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
