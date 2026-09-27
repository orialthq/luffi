import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/life_tip_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableLifeTipPlan(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'e' * 64,
    'actions': [
      {'id': 'first', 'factIndex': 1, 'text': '영수증 모으기', 'order': 1},
      {'id': 'third', 'factIndex': 3, 'text': '보관하기', 'order': 2},
    ],
    'candidates': [
      {'factIndex': 1, 'text': '영수증 모으기'},
      {'factIndex': 2, 'text': '날짜별 정리'},
      {'factIndex': 3, 'text': '보관하기'},
    ],
  };

  @override
  Future<KernelJson> correctLifeTipPlan(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'life-tip editor removes, adds, and reviews source-backed steps',
    (tester) async {
      final client = _Client();
      await tester.pumpWidget(
        MaterialApp(
          home: LifeTipCorrectionScreen(client: client, activityId: 'tip-1'),
        ),
      );
      await tester.pumpAndSettle();
      final first = find.byKey(const ValueKey('life-tip-selected-1'));
      await tester.tap(
        find.descendant(of: first, matching: find.byTooltip('단계 제외')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('life-tip-add-2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('submit-life-tip-correction')));
      await tester.pumpAndSettle();
      expect(find.textContaining('기존 실행 기록은 당시 단계'), findsOneWidget);
      await tester.tap(find.text('정정 반영'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(1));
      expect(client.requests.single['factIndexes'], [3, 2]);
      expect(client.requests.single['expectedGraphFingerprint'], 'e' * 64);
      expect(client.requests.single['confirmed'], true);
    },
  );
}
