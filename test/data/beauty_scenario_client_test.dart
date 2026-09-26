import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test('real beauty image responses remain observed product candidates', () {
    const cases = <String, String>{
      'a_cleanser': '데일리 클렌징 젤',
      'b_moisturizer': '수분 장벽 크림',
    };
    for (final entry in cases.entries) {
      final recorded =
          jsonDecode(
                File(
                  'server/test/fixtures/beauty_${entry.key}_live_analysis.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final analysis = StructuredContentAnalysis.fromJson(
        Map<String, Object?>.from(recorded),
      );
      expect(analysis.contentKind, ContentKind.beautyProduct);
      expect(analysis.title.value, entry.value);
      expect(analysis.title.status.name, 'observed');
    }
  });

  test('beauty creation intent survives restart until acknowledged', () async {
    final directory = await Directory.systemTemp.createTemp(
      'luffi-beauty-intent-',
    );
    addTearDown(() => directory.delete(recursive: true));
    final first = FileBeautyScenarioIntentStore(directoryPath: directory.path);
    final request = <String, Object?>{
      'commandId': 'stable-beauty-create',
      'activityId': 'beauty-1',
      'confirmed': true,
      'importIds': ['capture-a', 'capture-b'],
      'occasion': '저녁 루틴',
      'scheduledAt': '2026-09-27T12:00:00.000Z',
    };
    await first.save(request);
    final reopened = FileBeautyScenarioIntentStore(
      directoryPath: directory.path,
    );
    expect(await reopened.load(), request);
    await reopened.clear();
    expect(await first.load(), isNull);
  });

  test('beauty client sends create, confirm and outcome requests', () async {
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
      request.response.write('{"activityId":"beauty-1","revision":2}');
      await request.response.close();
    });
    final client = HttpCommonKernelClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'development-token',
    );
    await client.createBeautyScenario({
      'commandId': 'create-a',
      'activityId': 'beauty-1',
      'confirmed': true,
      'importIds': ['capture-a'],
      'occasion': '저녁 루틴',
      'scheduledAt': '2026-09-27T12:00:00.000Z',
    });
    await client.confirmBeautyRoutine({
      'commandId': 'confirm-a',
      'activityId': 'beauty-1',
      'expectedRevision': 2,
      'selections': [
        {
          'importId': 'capture-a',
          'variantLabel': '150 mL',
          'stepTitle': '저녁 세안',
        },
      ],
    });
    await client.recordBeautyRoutineOutcome({
      'commandId': 'outcome-a',
      'activityId': 'beauty-1',
      'expectedRevision': 4,
      'steps': [
        {'templateStepId': 'step-a', 'status': 'completed'},
      ],
    });
    expect(paths, [
      '/v1/kernel/beauty/scenarios',
      '/v1/kernel/beauty/confirm-routine',
      '/v1/kernel/beauty/routine-outcome',
    ]);
    expect(bodies[0]['confirmed'], true);
    expect(bodies[1]['selections'], hasLength(1));
    expect(bodies[2]['steps'], hasLength(1));
    expect(bodies.every((body) => !body.containsKey('ownerId')), isTrue);
  });
}
