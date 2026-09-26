import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';
import '../../domain/models.dart';

/// Edits the imported knowledge assertion, leaving the captured image and the
/// original analysis snapshot intact for provenance and later comparison.
final class ImportedFieldCorrectionScreen extends StatefulWidget {
  const ImportedFieldCorrectionScreen({
    required this.importId,
    required this.attachments,
    this.client,
    super.key,
  });

  final String importId;
  final List<IncomingAttachment> attachments;
  final CommonKernelClient? client;

  @override
  State<ImportedFieldCorrectionScreen> createState() =>
      _ImportedFieldCorrectionScreenState();
}

final class _ImportedFieldCorrectionScreenState
    extends State<ImportedFieldCorrectionScreen> {
  late final CommonKernelClient _client =
      widget.client ?? const HttpCommonKernelClient();
  KernelJson? _data;
  KernelJson? _pendingRequest;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await _client.getEditableCaptureFields(widget.importId);
      if (!mounted) return;
      setState(() => _data = data);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit(KernelJson field) async {
    if (_busy || _pendingRequest != null) return;
    final current = field['value'];
    final path = field['path'];
    final revision = field['revision'];
    if (current is! String || path is! String || revision is! int) return;
    var entered = current;
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${_fieldLabel(path)} 정정'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('원본 분석: ${field['originalValue'] ?? current}'),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('field-correction-input'),
                initialValue: current,
                onChanged: (text) => entered = text,
                maxLength: 512,
                maxLines:
                    path.contains('/value') || path.contains('/instruction')
                    ? 3
                    : 1,
                decoration: const InputDecoration(labelText: '확인한 내용'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('취소'),
          ),
          FilledButton(
            key: const Key('field-correction-confirm'),
            onPressed: () => Navigator.pop(context, entered.trim()),
            child: const Text('정정 반영'),
          ),
        ],
      ),
    );
    if (!mounted || value == null || value.isEmpty || value == current) return;
    final salt = Random.secure().nextInt(1 << 32);
    _pendingRequest = {
      'commandId':
          'field-correction-${DateTime.now().microsecondsSinceEpoch}-$salt',
      'importId': widget.importId,
      'path': path,
      'value': value,
      'expectedRevision': revision,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pendingRequest;
    if (request == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.correctImportedField(request);
      _pendingRequest = null;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('정정을 반영했어요. 연결된 활동에서 변경 내용을 확인해 주세요.')),
      );
      final data = await _client.getEditableCaptureFields(widget.importId);
      if (!mounted) return;
      setState(() => _data = data);
    } catch (error) {
      if (!mounted) return;
      if (error is CommonKernelException &&
          [
            'FIELD_REVISION_CONFLICT',
            'FIELD_NOT_EDITABLE',
            'IMPORT_NOT_FOUND',
          ].contains(error.code)) {
        _pendingRequest = null;
      }
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fields =
        (_data?['fields'] as List?)
            ?.whereType<Map>()
            .map((item) => Map<String, Object?>.from(item))
            .toList() ??
        const <KernelJson>[];
    return Scaffold(
      appBar: AppBar(title: const Text('캡처 내용 정정')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text('원본을 보며 잘못 읽힌 내용만 고쳐 주세요. 이전 값과 정정 근거는 함께 남습니다.'),
            if (widget.attachments.isNotEmpty) ...[
              const SizedBox(height: 16),
              SizedBox(
                height: 260,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: widget.attachments.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (_, index) => ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(
                      File(widget.attachments[index].filePath),
                      width: 190,
                      fit: BoxFit.contain,
                      semanticLabel: '원본 캡처 ${index + 1}',
                      errorBuilder: (_, _, _) => const SizedBox(
                        width: 190,
                        child: Center(child: Text('이미지를 불러오지 못했어요')),
                      ),
                    ),
                  ),
                ),
              ),
            ],
            if (_busy) const LinearProgressIndicator(),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text('정정을 확인하지 못했어요: $_error'),
              TextButton(
                onPressed: _busy
                    ? null
                    : _pendingRequest == null
                    ? _load
                    : _submit,
                child: Text(_pendingRequest == null ? '새로고침' : '같은 요청 다시 보내기'),
              ),
            ],
            if (_data != null && fields.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 20),
                child: Text('이 캡처에는 현재 정정할 수 있는 필드가 없어요.'),
              ),
            for (final field in fields) ...[
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _fieldLabel('${field['path']}'),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text('원본 분석: ${field['originalValue']}'),
                      Text('현재 사용: ${field['value']}'),
                      for (final evidence
                          in (field['evidence'] as List? ?? const []))
                        if (evidence is Map && evidence['quote'] is String)
                          Text('화면 근거: ${evidence['quote']}'),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          key: Key('correct-field-${field['path']}'),
                          onPressed: _busy || _pendingRequest != null
                              ? null
                              : () => _edit(field),
                          child: const Text('정정'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _fieldLabel(String path) {
  if (path == '/title/value') return '제목';
  if (path == '/place/name') return '장소 이름';
  if (path == '/place/searchArea') return '지역';
  if (path == '/place/address') return '주소';
  final step = RegExp(
    r'^/(?:facts|steps)/(\d+)/(?:value|instruction)$',
  ).firstMatch(path);
  if (step != null) return '${int.parse(step.group(1)!) + 1}단계';
  return path;
}
