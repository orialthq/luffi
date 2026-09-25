import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/reviewed_capture_import_client.dart';
import 'package:ori_beauty/domain/models.dart';

void main() {
  test('HTTP bridge uses the reviewed import and tombstone routes', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    final received = <({String path, String? authorization, Object? body})>[];
    server.listen((request) async {
      final body = jsonDecode(await utf8.decoder.bind(request).join());
      received.add((
        path: request.uri.path,
        authorization: request.headers.value(HttpHeaders.authorizationHeader),
        body: body,
      ));
      request.response.headers.contentType = ContentType.json;
      if (request.uri.path.endsWith('/delete')) {
        request.response.write(jsonEncode({'importId': body['importId']}));
      } else {
        request.response.write(
          jsonEncode({
            'importId': body['importId'],
            'sourceId': 'source-http',
            'sourceVersionId': 'version-http',
            'materialId': 'material-http',
            'replayed': false,
          }),
        );
      }
      await request.response.close();
    });
    final client = HttpReviewedCaptureImportClient(
      baseUrl: 'http://127.0.0.1:${server.port}',
      token: 'synthetic-development-token',
    );
    final fixture =
        jsonDecode(
              File(
                'server/test/fixtures/flutter_reviewed_recipe_import.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;

    final receipt = await client.importReviewedCapture(fixture);
    expect(receipt.sourceId, 'source-http');
    await client.deleteReviewedImport(
      importId: receipt.importId,
      commandId: 'reviewed-source-delete:${receipt.importId}',
    );

    expect(received.map((item) => item.path), [
      '/v1/kernel/ingestion/reviewed-capture',
      '/v1/kernel/ingestion/reviewed-capture/delete',
    ]);
    expect(
      received.every(
        (item) => item.authorization == 'Bearer synthetic-development-token',
      ),
      isTrue,
    );
    expect(received.last.body, {
      'importId': receipt.importId,
      'commandId': 'reviewed-source-delete:${receipt.importId}',
    });
  });

  test('Flutter reviewed recipe request matches the shared server fixture', () {
    const structured = StructuredContentAnalysis(
      schemaVersion: '2.1',
      model: 'gpt-5.6-luna',
      domain: ContentDomain.food,
      contentKind: ContentKind.recipe,
      tags: [
        ContentTag(value: '레시피', evidenceIds: ['e-title']),
      ],
      completeness: StructuredCompleteness.complete,
      title: StructuredTitle(
        value: '두부조림',
        status: ObservedStatus.observed,
        confidence: 0.98,
        evidenceIds: ['e-title'],
      ),
      place: null,
      summary: '두부 200g으로 만드는 두부조림',
      evidence: [
        StructuredEvidence(
          id: 'e-title',
          text: '두부조림',
          region: 'image_text',
          confidence: 0.98,
        ),
        StructuredEvidence(
          id: 'e-ingredient',
          text: '두부 200g',
          region: 'image_text',
          confidence: 0.97,
        ),
        StructuredEvidence(
          id: 'e-step',
          text: '팬에서 5분 졸이기',
          region: 'caption',
          confidence: 0.9,
        ),
      ],
      ingredientGroups: [
        IngredientGroup(
          name: '주재료',
          ingredients: [
            RecipeIngredient(
              name: '두부',
              amount: '200',
              unit: 'g',
              preparation: null,
              optional: false,
              originalText: '두부 200g',
              confidence: 0.97,
              evidenceIds: ['e-ingredient'],
            ),
          ],
        ),
      ],
      steps: [
        RecipeStep(
          order: 1,
          instruction: '팬에서 5분 졸이기',
          durationSeconds: 300,
          temperature: null,
          evidenceIds: ['e-step'],
        ),
      ],
      facts: [
        AnalysisFact(
          label: '기준 인분',
          value: '2인분',
          confidence: 0.9,
          evidenceIds: ['e-title'],
        ),
      ],
      conflicts: [],
      warnings: [],
    );
    final capturedAt = DateTime.utc(2026, 9, 20, 10);
    final capture = CaptureRecord(
      raw: RawCapture(
        id: 'capture-synthetic-recipe',
        transportEventId: 'synthetic-recipe',
        receivedAt: capturedAt,
        origin: CaptureOrigin.manual,
        mimeType: 'text/plain',
        rawText: 'synthetic reviewed recipe text',
        rawUrl: 'https://example.invalid/recipe?private=removed',
        semanticFingerprint: 'fixture',
        wasTruncated: false,
        originalLength: 30,
        sourcePackage: 'synthetic.recipe',
      ),
      normalized: const NormalizedInput(
        inputId: 'capture-synthetic-recipe',
        normalizerVersion: 'fixture-v1',
        normalizedText: '두부조림 두부 200g',
        urls: [],
        semanticFingerprint: 'fixture',
        completeness: MaterialCompleteness.complete,
        warnings: [],
      ),
      status: CaptureStatus.organized,
      analysis: AnalysisRun(
        id: 'analysis-synthetic-recipe',
        inputId: 'capture-synthetic-recipe',
        normalizerVersion: 'fixture-v1',
        analyzerVersion: 'fixture-v1',
        status: AnalysisRunStatus.succeeded,
        completedAt: capturedAt,
        evidence: const [],
        productMentions: const [],
        statements: const [],
        disclosure: DisclosureObservation.unknown,
        structuredContent: structured,
      ),
      review: UserReview(
        id: 'review-synthetic-recipe',
        captureId: 'capture-synthetic-recipe',
        analysisRunId: 'analysis-synthetic-recipe',
        resolution: ReviewResolution.confirmed,
        reviewedAt: DateTime.utc(2026, 9, 25, 10),
      ),
    );
    final request = reviewedCaptureImportRequest(capture)!;
    final fixture = File(
      'server/test/fixtures/flutter_reviewed_recipe_import.json',
    );
    expect(jsonDecode(fixture.readAsStringSync()), request);
    expect(request['analysis'], structured.toJson());
    expect(jsonEncode(request), isNot(contains('private=removed')));
    expect(jsonEncode(request), isNot(contains('rawText')));
  });
}
