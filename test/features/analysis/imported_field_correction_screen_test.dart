import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/analysis/imported_field_correction_screen.dart';

final class _CorrectionClient implements CommonKernelClient {
  String value = '모퉁이식당 성수점';
  int revision = 1;
  bool timeOutOnce = true;
  final requests = <KernelJson>[];

  @override
  Future<KernelJson> getEditableCaptureFields(String importId) async => {
    'importId': importId,
    'fields': [
      {
        'path': '/place/name',
        'value': value,
        'originalValue': '모퉁이식당 성수점',
        'revision': revision,
        'evidence': [
          {'quote': '모퉁이식당 성수점', 'region': 'image_text'},
        ],
      },
    ],
  };

  @override
  Future<KernelJson> correctImportedField(KernelJson request) async {
    requests.add(Map<String, Object?>.from(request));
    if (value != request['value']) {
      value = request['value'] as String;
      revision += 1;
    }
    if (timeOutOnce) {
      timeOutOnce = false;
      throw const CommonKernelException('NETWORK_TIMEOUT', '시간이 지났어요');
    }
    return {'importId': request['importId'], 'replayed': true};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'shows original evidence and retries the same correction command',
    (tester) async {
      final client = _CorrectionClient();
      await tester.pumpWidget(
        MaterialApp(
          home: ImportedFieldCorrectionScreen(
            importId: 'capture-1',
            attachments: const [],
            client: client,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('화면 근거: 모퉁이식당 성수점'), findsOneWidget);
      await tester.tap(find.byKey(const Key('correct-field-/place/name')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('field-correction-input')),
        '모퉁이식당 성수 본점',
      );
      await tester.tap(find.byKey(const Key('field-correction-confirm')));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(1));
      expect(client.requests.single['expectedRevision'], 1);
      expect(find.text('같은 요청 다시 보내기'), findsOneWidget);
      await tester.tap(find.text('같은 요청 다시 보내기'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(2));
      expect(client.requests[1], client.requests[0]);
      expect(find.text('현재 사용: 모퉁이식당 성수 본점'), findsOneWidget);
    },
  );
}
