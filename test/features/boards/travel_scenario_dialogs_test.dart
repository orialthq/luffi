import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/travel_scenario_dialogs.dart';

void main() {
  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets('travel creation chooses reviewed places from one area', (
    tester,
  ) async {
    tallScreen(tester);
    KernelJson? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                result = await showDialog<KernelJson>(
                  context: context,
                  builder: (_) => const TravelScenarioDialog(
                    options: [
                      TravelImportOption(
                        importId: 'coast',
                        name: '푸른곶 해안길',
                        searchArea: '제주',
                      ),
                      TravelImportOption(
                        importId: 'view',
                        name: '바람언덕 전망대',
                        searchArea: '제주',
                      ),
                      TravelImportOption(
                        importId: 'park',
                        name: '다른 공원',
                        searchArea: '서울',
                      ),
                    ],
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('다른 공원'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('travel-import-coast')));
    await tester.tap(find.byKey(const ValueKey('travel-import-view')));
    await tester.tap(find.byKey(const Key('travel-create-submit')));
    await tester.pumpAndSettle();
    expect(result?['area'], '제주');
    expect(result?['importIds'], ['coast', 'view']);
    expect(result?['startAt'], isA<String>());
  });

  testWidgets('travel confirmation uses the explicitly reordered times', (
    tester,
  ) async {
    tallScreen(tester);
    List<KernelJson>? result;
    final startAt = DateTime(2026, 9, 28, 9).toUtc().toIso8601String();
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                result = await showDialog<List<KernelJson>>(
                  context: context,
                  builder: (_) => TravelConfirmDialog(
                    startAt: startAt,
                    candidates: const [
                      {
                        'importId': 'view',
                        'name': '바람언덕 전망대',
                        'searchArea': '제주',
                      },
                      {
                        'importId': 'coast',
                        'name': '푸른곶 해안길',
                        'searchArea': '제주',
                      },
                    ],
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-stop-up-coast')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('travel-confirm-submit')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.textContaining('모든 방문 시각'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('travel-stop-time-coast')),
      '10:00',
    );
    await tester.enterText(
      find.byKey(const ValueKey('travel-stop-time-view')),
      '13:00',
    );
    await tester.tap(find.byKey(const Key('travel-confirm-submit')));
    await tester.pumpAndSettle();
    expect(result?.map((item) => item['importId']).toList(), ['coast', 'view']);
    expect(
      DateTime.parse(
        result![0]['plannedAt']! as String,
      ).isBefore(DateTime.parse(result![1]['plannedAt']! as String)),
      isTrue,
    );
  });

  testWidgets('travel outcome requires every stop and preserves each status', (
    tester,
  ) async {
    tallScreen(tester);
    List<KernelJson>? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                result = await showDialog<List<KernelJson>>(
                  context: context,
                  builder: (_) => const TravelOutcomeDialog(
                    stops: [
                      {'id': 'coast-stop', 'title': '푸른곶 해안길'},
                      {'id': 'view-stop', 'title': '바람언덕 전망대'},
                    ],
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('travel-outcome-submit')));
    await tester.pumpAndSettle();
    expect(result, isNull);
    expect(find.text('모든 장소의 방문 여부를 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('travel-outcome-coast-stop')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('다녀왔어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-outcome-view-stop')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('못 갔어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('travel-outcome-submit')));
    await tester.pumpAndSettle();
    expect(result, [
      {'stopId': 'coast-stop', 'status': 'visited'},
      {'stopId': 'view-stop', 'status': 'skipped'},
    ]);
  });
}
