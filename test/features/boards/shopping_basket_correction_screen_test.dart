import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/shopping_basket_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableShoppingBasket(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'b' * 64,
    'basket': {
      'id': 'basket-a',
      'kind': 'basket',
      'lines': [
        {
          'ingredientId': 'tofu',
          'name': '두부',
          'choices': [
            {
              'id': 'choice-a',
              'importId': 'tofu',
              'quantity': 2,
              'packageQuantity': {
                'status': 'known',
                'amount': 300,
                'unit': 'g',
              },
              'packageEvidenceIds': ['tofu-title'],
            },
          ],
        },
      ],
    },
    'recipeItems': [
      {
        'ingredientId': 'tofu',
        'name': '두부',
        'missingQuantity': {'status': 'known', 'amount': 500, 'unit': 'g'},
      },
    ],
    'candidates': [
      {
        'importId': 'tofu',
        'title': '두부 300g',
        'displayedPriceText': '2,400원',
        'titleEvidenceIds': ['tofu-title'],
        'details': <Object?>[],
      },
    ],
  };

  @override
  Future<KernelJson> correctShoppingBasket(KernelJson request) async {
    requests.add(request);
    return {'basketId': 'basket-b'};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets('basket editor preloads choices and can remove the last item', (
    tester,
  ) async {
    final client = _Client();
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: ShoppingBasketCorrectionScreen(
          client: client,
          activityId: 'shop-1',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('shopping-basket-correction-edit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('basket-product-tofu-0')), findsOneWidget);
    expect(find.text('2'), findsWidgets);
    await tester.tap(find.byTooltip('상품 빼기'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('basket-confirm')));
    await tester.pumpAndSettle();
    expect(find.textContaining('0개 상품 선택'), findsOneWidget);
    await tester.tap(find.text('정정 반영'));
    await tester.pumpAndSettle();
    expect(client.requests, hasLength(1));
    expect(client.requests.single['selections'], isEmpty);
    expect(client.requests.single['expectedGraphFingerprint'], 'b' * 64);
    expect(client.requests.single['confirmed'], true);
  });
}
