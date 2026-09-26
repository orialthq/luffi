import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test('real travel image responses remain observed attraction candidates', () {
    const cases = <String, String>{
      'a_viewpoint': '바람언덕 전망대',
      'b_coastwalk': '푸른곶 해안길',
    };
    for (final entry in cases.entries) {
      final recorded =
          jsonDecode(
                File(
                  'server/test/fixtures/travel_${entry.key}_live_analysis.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final analysis = StructuredContentAnalysis.fromJson(
        Map<String, Object?>.from(recorded),
      );
      expect(analysis.contentKind, ContentKind.place);
      expect(analysis.place?.name, entry.value);
      expect(analysis.place?.searchArea, '제주');
      expect(analysis.place?.category, PlaceCategory.activity);
    }
  });

  test('travel creation intent survives restart until acknowledged', () async {
    final directory = await Directory.systemTemp.createTemp(
      'luffi-travel-intent-',
    );
    addTearDown(() => directory.delete(recursive: true));
    final first = FileTravelScenarioIntentStore(directoryPath: directory.path);
    final request = <String, Object?>{
      'commandId': 'stable-travel-create',
      'activityId': 'trip-1',
      'confirmed': true,
      'importIds': ['place-a', 'place-b'],
      'area': '제주',
      'startAt': '2026-09-28T00:00:00.000Z',
    };
    await first.save(request);
    final reopened = FileTravelScenarioIntentStore(
      directoryPath: directory.path,
    );
    expect(await reopened.load(), request);
    await reopened.clear();
    expect(await first.load(), isNull);
  });

  test(
    'travel client sends create, confirmation and outcome requests',
    () async {
      final paths = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        expect(
          request.headers.value(HttpHeaders.authorizationHeader),
          'Bearer development-token',
        );
        paths.add(request.uri.path);
        bodies.add(
          jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>,
        );
        request.response.headers.contentType = ContentType.json;
        request.response.write('{"activityId":"trip-1","revision":2}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await client.createTravelScenario({
        'commandId': 'create-trip',
        'activityId': 'trip-1',
        'confirmed': true,
        'importIds': ['place-a'],
        'area': '제주',
        'startAt': '2026-09-28T00:00:00.000Z',
      });
      await client.confirmTravelItinerary({
        'commandId': 'confirm-trip',
        'activityId': 'trip-1',
        'expectedRevision': 2,
        'selections': [
          {'importId': 'place-a', 'plannedAt': '2026-09-28T01:00:00.000Z'},
        ],
      });
      await client.recordTravelStopOutcomes({
        'commandId': 'outcome-trip',
        'activityId': 'trip-1',
        'expectedRevision': 3,
        'stops': [
          {'stopId': 'stop-a', 'status': 'visited'},
        ],
      });
      expect(paths, [
        '/v1/kernel/travel/scenarios',
        '/v1/kernel/travel/confirm-itinerary',
        '/v1/kernel/travel/stop-outcomes',
      ]);
      expect(bodies[0]['area'], '제주');
      expect(bodies[1]['selections'], hasLength(1));
      expect(bodies[2]['stops'], hasLength(1));
      expect(bodies.every((body) => !body.containsKey('ownerId')), isTrue);
    },
  );
}
