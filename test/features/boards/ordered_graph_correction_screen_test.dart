import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/ordered_graph_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableBeautyRoutine(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'a' * 64,
    'steps': [
      {'id': 'wash', 'title': '세안', 'variantId': 'cleanser', 'order': 1},
      {'id': 'cream', 'title': '크림', 'variantId': 'moisturizer', 'order': 2},
    ],
    'originalSteps': [
      {'id': 'wash', 'title': '세안'},
      {'id': 'cream', 'title': '크림'},
    ],
  };

  @override
  Future<KernelJson> correctBeautyRoutine(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  Future<KernelJson> getEditableTravelItinerary(String activityId) async => {
    'activityId': activityId,
    'graphFingerprint': 'b' * 64,
    'startAt': '2026-09-28T09:00:00+09:00',
    'stops': [
      {
        'id': 'coast',
        'title': '해안길',
        'plannedAt': '2026-09-28T10:00:00+09:00',
        'order': 1,
      },
      {
        'id': 'hill',
        'title': '언덕',
        'plannedAt': '2026-09-28T13:00:00+09:00',
        'order': 2,
      },
    ],
    'originalStops': [
      {'id': 'coast', 'title': '해안길'},
      {'id': 'hill', 'title': '언덕'},
    ],
  };

  @override
  Future<KernelJson> correctTravelItinerary(KernelJson request) async {
    requests.add(request);
    return {'activityId': request['activityId']};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _open(WidgetTester tester, _Client client, String scenario) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => FilledButton(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => OrderedGraphCorrectionScreen(
                  client: client,
                  activityId: 'activity-1',
                  scenario: scenario,
                ),
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
  testWidgets(
    'beauty correction submits reordered steps and product relation',
    (tester) async {
      final client = _Client();
      await _open(tester, client, 'beauty');
      await tester.tap(find.byTooltip('위로').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '크림 충분히 바르기');
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('submit-ordered-graph-correction')),
        250,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.drag(find.byType(ListView), const Offset(0, -300));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const Key('submit-ordered-graph-correction')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('정정 반영'));
      await tester.pumpAndSettle();
      final steps = client.requests.single['steps'] as List;
      expect((steps.first as Map)['id'], 'cream');
      expect((steps.first as Map)['title'], '크림 충분히 바르기');
      expect((steps.first as Map)['variantId'], 'moisturizer');
      expect(client.requests.single['confirmed'], true);
    },
  );

  testWidgets('travel correction validates ordered times before submission', (
    tester,
  ) async {
    final client = _Client();
    await _open(tester, client, 'travel');
    await tester.tap(find.byTooltip('위로').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const Key('submit-ordered-graph-correction')),
    );
    await tester.tap(find.byKey(const Key('submit-ordered-graph-correction')));
    await tester.pumpAndSettle();
    expect(client.requests, isEmpty);
    expect(find.textContaining('순서대로 입력'), findsOneWidget);
    await tester.enterText(
      find.byType(TextField).first,
      '2026-09-28T10:00:00+09:00',
    );
    await tester.enterText(
      find.byType(TextField).last,
      '2026-09-28T13:00:00+09:00',
    );
    await tester.tap(find.byKey(const Key('submit-ordered-graph-correction')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('정정 반영'));
    await tester.pumpAndSettle();
    final stops = client.requests.single['stops'] as List;
    expect((stops.first as Map)['id'], 'hill');
    expect(client.requests.single['expectedGraphFingerprint'], 'b' * 64);
  });
}
