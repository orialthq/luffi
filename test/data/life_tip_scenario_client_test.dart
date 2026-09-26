import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test('live image response remains a grounded three-step life tip', () {
    final recorded =
        jsonDecode(
              File(
                'server/test/fixtures/life_tip_receipts_live_analysis.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final analysis = StructuredContentAnalysis.fromJson(
      Map<String, Object?>.from(recorded),
    );
    expect(analysis.contentKind, ContentKind.unknown);
    expect(analysis.completeness, StructuredCompleteness.complete);
    expect(analysis.title.status, ObservedStatus.observed);
    expect(analysis.title.value, '영수증 정리 3단계');
    expect(analysis.facts.map((item) => item.label), ['1단계', '2단계', '3단계']);
    expect(analysis.facts.every((item) => item.evidenceIds.isNotEmpty), isTrue);
  });

  test(
    'life-tip creation intent survives restart until acknowledged',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'luffi-life-tip-intent-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final first = FileLifeTipScenarioIntentStore(
        directoryPath: directory.path,
      );
      final request = <String, Object?>{
        'commandId': 'stable-tip-create',
        'activityId': 'tip-1',
        'confirmed': true,
        'importId': 'receipt-tip',
      };
      await first.save(request);
      final reopened = FileLifeTipScenarioIntentStore(
        directoryPath: directory.path,
      );
      expect(await reopened.load(), request);
      await reopened.clear();
      expect(await first.load(), isNull);
    },
  );

  test(
    'life-tip client sends creation, confirmation, and outcome requests',
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
        request.response.write('{"activityId":"tip-1","revision":2}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await client.createLifeTipScenario({
        'commandId': 'create-tip',
        'activityId': 'tip-1',
        'confirmed': true,
        'importId': 'receipt-tip',
      });
      await client.confirmLifeTipActions({
        'commandId': 'confirm-tip',
        'activityId': 'tip-1',
        'expectedRevision': 2,
        'factIndexes': [1, 3],
      });
      await client.recordLifeTipOutcomes({
        'commandId': 'outcome-tip',
        'activityId': 'tip-1',
        'expectedRevision': 3,
        'actions': [
          {'actionId': 'action-1', 'status': 'done'},
        ],
      });
      expect(paths, [
        '/v1/kernel/life-tip/scenarios',
        '/v1/kernel/life-tip/confirm-actions',
        '/v1/kernel/life-tip/outcomes',
      ]);
      expect(bodies[1]['factIndexes'], [1, 3]);
      expect((bodies[2]['actions'] as List).single['status'], 'done');
    },
  );
}
