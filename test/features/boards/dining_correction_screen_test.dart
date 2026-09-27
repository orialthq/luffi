import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/dining_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableDiningSelection(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'd' * 64,
    'candidateId': 'place-a',
    'placeId': 'entity-a',
    'candidates': [
      {
        'id': 'place-a',
        'name': '성수국수집',
        'searchArea': '성수',
        'importIds': ['a'],
      },
      {
        'id': 'place-b',
        'name': '성수밥집',
        'searchArea': '성수',
        'importIds': ['b'],
      },
    ],
  };

  @override
  Future<KernelJson> correctDiningPlace(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'dining correction sends the reviewed candidate and graph version',
    (tester) async {
      final client = _Client();
      await tester.pumpWidget(
        MaterialApp(
          home: DiningCorrectionScreen(client: client, activityId: 'dinner'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('submit-dining-correction')), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('submit-dining-correction')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const ValueKey('dining-correction-place-b')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('submit-dining-correction')));
      await tester.pumpAndSettle();
      expect(find.textContaining('기존 방문 기록은 보존'), findsOneWidget);
      await tester.tap(find.text('정정 반영'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(1));
      expect(client.requests.single['candidateId'], 'place-b');
      expect(client.requests.single['expectedGraphFingerprint'], 'd' * 64);
      expect(client.requests.single['confirmed'], true);
    },
  );
}
