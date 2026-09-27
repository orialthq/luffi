import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/shopping_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableShoppingChoice(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'c' * 64,
    'choice': {
      'importId': 'item-a',
      'title': '수납함',
      'quantity': 2,
      'displayedPriceText': '12,900원',
    },
    'candidates': [
      {'importId': 'item-a', 'title': '수납함', 'displayedPriceText': '12,900원'},
      {'importId': 'item-b', 'title': '보관함', 'displayedPriceText': '15,900원'},
    ],
  };

  @override
  Future<KernelJson> correctShoppingChoice(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets('shopping editor confirms a source-backed product and quantity', (
    tester,
  ) async {
    final client = _Client();
    await tester.pumpWidget(
      MaterialApp(
        home: ShoppingCorrectionScreen(client: client, activityId: 'shop-1'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('shopping-correction-item-b')));
    await tester.tap(find.byKey(const Key('shopping-correction-plus')));
    await tester.tap(find.byKey(const Key('shopping-correction-submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('기존 선택과 구매 기록'), findsOneWidget);
    await tester.tap(find.text('정정 반영'));
    await tester.pumpAndSettle();
    expect(client.requests, hasLength(1));
    expect(client.requests.single['selectedImportId'], 'item-b');
    expect(client.requests.single['quantity'], 3);
    expect(client.requests.single['expectedGraphFingerprint'], 'c' * 64);
    expect(client.requests.single['confirmed'], true);
  });
}
