import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test(
    'both live image responses remain evidence-backed shopping candidates',
    () {
      for (final (name, title, price) in [
        ('a_fabric_box', '접이식 패브릭 수납함', '12,900원'),
        ('b_clear_box', '투명 적층 수납함', '15,900원'),
      ]) {
        final recorded =
            jsonDecode(
                  File(
                    'server/test/fixtures/shopping_${name}_live_analysis.json',
                  ).readAsStringSync(),
                )
                as Map<String, dynamic>;
        final analysis = StructuredContentAnalysis.fromJson(
          Map<String, Object?>.from(recorded),
        );
        expect(analysis.contentKind, ContentKind.commerceProduct);
        expect(analysis.completeness, StructuredCompleteness.complete);
        expect(analysis.title.value, title);
        expect(analysis.title.evidenceIds, isNotEmpty);
        expect(
          analysis.facts.firstWhere((fact) => fact.label == '가격').value,
          price,
        );
        expect(
          analysis.facts.every((fact) => fact.evidenceIds.isNotEmpty),
          isTrue,
        );
      }
    },
  );

  test('shopping creation intent persists until acknowledged', () async {
    final directory = await Directory.systemTemp.createTemp(
      'luffi-shopping-intent-',
    );
    addTearDown(() => directory.delete(recursive: true));
    final first = FileShoppingScenarioIntentStore(
      directoryPath: directory.path,
    );
    final request = <String, Object?>{
      'commandId': 'create-shop',
      'activityId': 'shop-1',
      'confirmed': true,
      'importIds': ['a_fabric_box', 'b_clear_box'],
      'purpose': '수납함 고르기',
    };
    await first.save(request);
    final reopened = FileShoppingScenarioIntentStore(
      directoryPath: directory.path,
    );
    expect(await reopened.load(), request);
    await reopened.clear();
    expect(await first.load(), isNull);
  });

  test(
    'shopping client routes creation, selection, and purchase report',
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
        request.response.write('{"activityId":"shop-1","revision":2}');
        await request.response.close();
      });
      final client = HttpCommonKernelClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'development-token',
      );
      await client.createShoppingScenario({
        'commandId': 'create-shop',
        'activityId': 'shop-1',
        'confirmed': true,
        'importIds': ['a_fabric_box', 'b_clear_box'],
        'purpose': '수납함 고르기',
      });
      await client.confirmShoppingChoice({
        'commandId': 'choose-shop',
        'activityId': 'shop-1',
        'expectedRevision': 2,
        'selectedImportId': 'a_fabric_box',
        'quantity': 2,
      });
      await client.recordShoppingPurchaseOutcome({
        'commandId': 'report-shop',
        'activityId': 'shop-1',
        'expectedRevision': 3,
        'status': 'purchased',
        'actualPaidKrw': 13500,
      });
      expect(paths, [
        '/v1/kernel/shopping/scenarios',
        '/v1/kernel/shopping/confirm-choice',
        '/v1/kernel/shopping/purchase-outcome',
      ]);
      expect(bodies[1]['quantity'], 2);
      expect(bodies[2]['actualPaidKrw'], 13500);
    },
  );
}
