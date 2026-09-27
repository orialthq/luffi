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

  testWidgets('linked recipe choice requires an explicit ingredient decision', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingChoiceDialog(
        candidates: [
          {
            'importId': 'tofu-product',
            'title': '두부 300g',
            'displayedPriceText': '2,400원',
            'details': <Object?>[],
          },
        ],
        recipeItems: [
          {'ingredientId': 'tofu', 'name': '두부'},
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('shopping-choice-tofu-product')));
    await tester.tap(find.byKey(const Key('shopping-choice-submit')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('해당 재료를 확인하거나 미확인을 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('shopping-ingredient-tofu')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('shopping-choice-submit')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('포장 분량을 확인하거나 미확인을 선택해 주세요.'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('shopping-package-known')));
    await tester.tap(find.byKey(const Key('shopping-package-known')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('shopping-package-amount')),
      '300',
    );
    await tester.tap(find.byKey(const Key('shopping-choice-submit')));
    await tester.pumpAndSettle();
    expect(result, {
      'selectedImportId': 'tofu-product',
      'quantity': 1,
      'ingredientMatch': {'status': 'matched', 'ingredientId': 'tofu'},
      'packageQuantity': {'status': 'known', 'amount': 300.0, 'unit': 'g'},
    });
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

  testWidgets('basket purchase reports each selected product separately', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingBasketOutcomeDialog(
        basket: {
          'lines': [
            {
              'choices': [
                {'id': 'tofu-choice', 'title': '두부', 'quantity': 2},
              ],
            },
            {
              'choices': [
                {'id': 'egg-choice', 'title': '달걀', 'quantity': 1},
              ],
            },
          ],
        },
      ),
      (value) => result = value,
    );
    await tester.tap(
      find.byKey(const Key('basket-outcome-tofu-choice-purchased')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '4800');
    await tester.ensureVisible(
      find.byKey(const Key('basket-outcome-egg-choice-not_purchased')),
    );
    await tester.tap(
      find.byKey(const Key('basket-outcome-egg-choice-not_purchased')),
    );
    await tester.ensureVisible(
      find.byKey(const Key('basket-outcomes-confirm')),
    );
    await tester.tap(find.byKey(const Key('basket-outcomes-confirm')));
    await tester.pumpAndSettle();
    expect(result?['outcomes'], [
      {'choiceId': 'tofu-choice', 'status': 'purchased', 'actualPaidKrw': 4800},
      {'choiceId': 'egg-choice', 'status': 'not_purchased'},
    ]);
  });

  testWidgets('egg pack text offers an evidence-backed count candidate', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingBasketDialog(
        candidates: [
          {
            'importId': 'egg',
            'title': '달걀 10개입',
            'displayedPriceText': '4,900원',
            'titleEvidenceIds': ['egg-title'],
            'details': <Object?>[],
          },
        ],
        recipeItems: [
          {
            'ingredientId': 'egg',
            'name': '달걀',
            'missingQuantity': {
              'status': 'known',
              'amount': 4,
              'unit': 'count',
            },
          },
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('basket-add-egg')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('basket-product-egg-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('달걀 10개입 · 4,900원').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('화면에 표시된 10개입 사용'));
    await tester.tap(find.text('화면에 표시된 10개입 사용'));
    await tester.ensureVisible(find.byKey(const Key('basket-confirm')));
    await tester.tap(find.byKey(const Key('basket-confirm')));
    await tester.pumpAndSettle();
    expect((result?['selections'] as List).single, {
      'ingredientId': 'egg',
      'selectedImportId': 'egg',
      'quantity': 1,
      'packageQuantity': {'status': 'known', 'amount': 10.0, 'unit': 'count'},
      'packageEvidenceIds': ['egg-title'],
    });
  });

  testWidgets('inventory requires an observed total after purchase', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingInventoryDialog(
        basket: {
          'lines': [
            {
              'ingredientId': 'tofu',
              'name': '두부',
              'missingQuantity': {
                'status': 'known',
                'amount': 500,
                'unit': 'g',
              },
              'choices': [
                {'id': 'tofu-choice'},
              ],
            },
            {
              'ingredientId': 'egg',
              'name': '달걀',
              'missingQuantity': {
                'status': 'known',
                'amount': 4,
                'unit': 'count',
              },
              'choices': [
                {'id': 'egg-choice'},
              ],
            },
          ],
        },
        outcomes: [
          {'choiceId': 'tofu-choice', 'status': 'purchased'},
          {'choiceId': 'egg-choice', 'status': 'not_purchased'},
        ],
        previous: [],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('inventory-confirm')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('inventory-amount-tofu')),
      '700',
    );
    await tester.tap(find.byKey(const Key('inventory-confirm')));
    await tester.pumpAndSettle();
    expect(result?['observations'], [
      {
        'ingredientId': 'tofu',
        'quantity': {'status': 'known', 'amount': 700.0, 'unit': 'g'},
        'supportingChoiceIds': ['tofu-choice'],
      },
    ]);
  });

  testWidgets('purchase correction targets one product and requires the paid amount', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingPurchaseCorrectionDialog(
        choice: {
          'kind': 'basket',
          'lines': [
            {'choices': [
              {'id': 'tofu', 'title': '두부'},
              {'id': 'egg', 'title': '달걀'},
            ]},
          ],
        },
        outcomes: [
          {'choiceId': 'tofu', 'status': 'purchased', 'actualPaidKrw': 2400},
          {'choiceId': 'egg', 'status': 'not_purchased'},
        ],
      ),
      (value) => result = value,
    );
    await tester.tap(find.byKey(const Key('shopping-correct-choice')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('달걀').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('shopping-correct-status-purchased')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('shopping-correct-purchase-confirm')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('실제 지불액을 확인해 주세요.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('shopping-correct-paid')), '3900');
    await tester.tap(find.byKey(const Key('shopping-correct-purchase-confirm')));
    await tester.pumpAndSettle();
    expect(result, {'choiceId': 'egg', 'status': 'purchased', 'actualPaidKrw': 3900});
  });

  testWidgets('inventory correction keeps the exact observation revision', (
    tester,
  ) async {
    Map<String, Object?>? result;
    await openDialog(
      tester,
      const ShoppingInventoryCorrectionDialog(
        observations: [
          {
            'observationId': 'stock-a',
            'ingredientId': 'tofu',
            'assertionId': 'assertion-2',
            'quantity': {'status': 'known', 'amount': 700, 'unit': 'g'},
          },
        ],
      ),
      (value) => result = value,
    );
    await tester.enterText(
      find.byKey(const Key('shopping-correct-inventory-amount')),
      '650',
    );
    await tester.tap(find.byKey(const Key('shopping-correct-inventory-confirm')));
    await tester.pumpAndSettle();
    expect(result, {
      'observationId': 'stock-a',
      'expectedAssertionId': 'assertion-2',
      'quantity': {'status': 'known', 'amount': 650.0, 'unit': 'g'},
    });
  });
}
