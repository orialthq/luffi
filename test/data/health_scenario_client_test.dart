import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test('live image response keeps grounded workout steps', () {
    final recorded =
        jsonDecode(
              File(
                'server/test/fixtures/health_home_workout_live_analysis.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final analysis = StructuredContentAnalysis.fromJson(
      Map<String, Object?>.from(recorded),
    );
    expect(analysis.contentKind, ContentKind.unknown);
    expect(analysis.completeness, StructuredCompleteness.complete);
    expect(analysis.title.value, '집에서 하는 3단계 홈트');
    expect(
      analysis.tags.any(
        (tag) => tag.facet == TagFacet.field && tag.value == '건강·운동',
      ),
      isTrue,
    );
    expect(
      analysis.tags.any(
        (tag) => tag.facet == TagFacet.kind && tag.value == '운동',
      ),
      isTrue,
    );
    expect(analysis.facts.map((item) => item.value), [
      '제자리 걷기 5분',
      '스쿼트 10회',
      '어깨 돌리기 10회',
    ]);
    expect(analysis.facts.every((item) => item.evidenceIds.isNotEmpty), isTrue);
  });

  test('health creation intent survives restart until acknowledged', () async {
    final directory = await Directory.systemTemp.createTemp(
      'luffi-health-intent-',
    );
    addTearDown(() => directory.delete(recursive: true));
    final first = FileHealthScenarioIntentStore(directoryPath: directory.path);
    final request = <String, Object?>{
      'commandId': 'create-health',
      'activityId': 'workout-1',
      'confirmed': true,
      'importId': 'home-workout',
    };
    await first.save(request);
    final reopened = FileHealthScenarioIntentStore(
      directoryPath: directory.path,
    );
    expect(await reopened.load(), request);
    await reopened.clear();
    expect(await first.load(), isNull);
  });

  test(
    'health client routes creation, confirmation, and actual outcomes',
    () async {
      final paths = <String>[];
      final bodies = <Map<String, dynamic>>[];
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        paths.add(request.uri.path);
        bodies.add(
          jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>,
        );
        request.response.headers.contentType = ContentType.json;
        request.response.write('{"activityId":"workout-1","revision":2}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await client.createHealthScenario({
        'commandId': 'create-health',
        'activityId': 'workout-1',
        'confirmed': true,
        'importId': 'home-workout',
      });
      await client.confirmHealthExercises({
        'commandId': 'confirm-health',
        'activityId': 'workout-1',
        'expectedRevision': 2,
        'factIndexes': [1, 3],
      });
      await client.recordHealthExerciseOutcomes({
        'commandId': 'report-health',
        'activityId': 'workout-1',
        'expectedRevision': 3,
        'exercises': [
          {
            'exerciseId': 'step-1',
            'status': 'done',
            'actualAmount': 4,
            'actualUnit': 'minutes',
          },
          {'exerciseId': 'step-3', 'status': 'skipped'},
        ],
      });
      expect(paths, [
        '/v1/kernel/health/scenarios',
        '/v1/kernel/health/confirm-exercises',
        '/v1/kernel/health/exercise-outcomes',
      ]);
      expect(bodies[1]['factIndexes'], [1, 3]);
      expect((bodies[2]['exercises'] as List).first['actualAmount'], 4);
    },
  );
}
