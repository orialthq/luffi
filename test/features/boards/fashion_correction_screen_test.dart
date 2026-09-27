import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/fashion_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableFashionOutfit(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'c' * 64,
    'items': [
      {
        'variantId': 'jacket',
        'slot': 'outerwear',
        'ownership': 'candidate',
        'color': '차콜',
        'size': 'M',
      },
      {
        'variantId': 'trousers',
        'slot': 'bottom',
        'ownership': 'owned',
        'color': '베이지',
        'size': '30',
      },
    ],
    'originalItems': [
      {
        'variantId': 'jacket',
        'slot': 'outerwear',
        'ownership': 'candidate',
        'color': '차콜',
        'size': 'M',
      },
      {
        'variantId': 'trousers',
        'slot': 'bottom',
        'ownership': 'owned',
        'color': '베이지',
        'size': '30',
      },
    ],
  };

  @override
  Future<KernelJson> correctFashionOutfit(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'fashion editor rejects duplicate slots then submits explicit ownership',
    (tester) async {
      final client = _Client();
      await tester.pumpWidget(
        MaterialApp(
          home: FashionCorrectionScreen(client: client, activityId: 'outfit-1'),
        ),
      );
      await tester.pumpAndSettle();
      final dropdowns = find.byType(DropdownButtonFormField<String>);
      await tester.tap(dropdowns.at(0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('하의').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const Key('submit-fashion-correction')),
      );
      await tester.tap(find.byKey(const Key('submit-fashion-correction')));
      await tester.pumpAndSettle();
      expect(client.requests, isEmpty);
      expect(find.textContaining('같은 코디 자리'), findsOneWidget);

      await tester.tap(dropdowns.at(0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('상의').last);
      await tester.pumpAndSettle();
      await tester.tap(dropdowns.at(1));
      await tester.pumpAndSettle();
      await tester.tap(find.text('가지고 있어요').last);
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView), const Offset(0, -280));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('submit-fashion-correction')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('정정 반영'));
      await tester.pumpAndSettle();
      final request = client.requests.single;
      final items = request['items'] as List;
      expect((items.first as Map)['slot'], 'top');
      expect((items.first as Map)['ownership'], 'owned');
      expect(request['expectedGraphFingerprint'], 'c' * 64);
      expect(request['confirmed'], true);
    },
  );
}
