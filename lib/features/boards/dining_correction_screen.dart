import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class DiningCorrectionScreen extends StatefulWidget {
  const DiningCorrectionScreen({
    required this.client,
    required this.activityId,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;

  @override
  State<DiningCorrectionScreen> createState() => _DiningCorrectionScreenState();
}

final class _DiningCorrectionScreenState extends State<DiningCorrectionScreen> {
  KernelJson? _data;
  KernelJson? _pending;
  String? _candidateId;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.client.getEditableDiningSelection(
        widget.activityId,
      );
      if (!mounted) return;
      setState(() {
        _data = data;
        _candidateId = data['candidateId'] as String?;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review() async {
    final data = _data;
    final candidateId = _candidateId;
    if (_busy ||
        data == null ||
        candidateId == null ||
        candidateId == data['candidateId']) {
      return;
    }
    final candidates = (data['candidates'] as List).whereType<Map>().toList();
    final current = candidates.firstWhere(
      (item) => item['id'] == data['candidateId'],
    );
    final next = candidates.firstWhere((item) => item['id'] == candidateId);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('식당 선택 정정 확인'),
        content: Text(
          '${current['name']}에서 ${next['name']}로 선택 관계를 변경합니다. '
          '기존 방문 기록은 보존하고, 변경된 식사 계획은 새 활동에서 다시 확인해요.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('정정 반영'),
          ),
        ],
      ),
    );
    if (!mounted || accepted != true) return;
    _pending = {
      'commandId': newKernelCommandId(),
      'activityId': widget.activityId,
      'expectedGraphFingerprint': data['graphFingerprint'],
      'candidateId': candidateId,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pending;
    if (_busy || request == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.correctDiningPlace(request);
      _pending = null;
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      final retryable =
          error is CommonKernelException &&
          (['NETWORK_TIMEOUT', 'NETWORK_UNAVAILABLE'].contains(error.code) ||
              error.statusCode == 429 ||
              (error.statusCode != null && error.statusCode! >= 500));
      if (!retryable) _pending = null;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('선택한 식당 정정')),
    body: _data == null && _busy
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_busy) const LinearProgressIndicator(),
              if (_error != null) ...[
                Text('정정을 확인하지 못했어요: $_error'),
                TextButton(
                  onPressed: _busy
                      ? null
                      : _pending == null
                      ? _load
                      : _submit,
                  child: Text(_pending == null ? '새로고침' : '같은 요청 다시 보내기'),
                ),
              ],
              if (_data != null) ...[
                const Text('이 활동에 저장된 식당 후보 중 실제 선택한 지점을 고르세요.'),
                RadioGroup<String>(
                  groupValue: _candidateId,
                  onChanged: _busy || _pending != null
                      ? (_) {}
                      : (value) => setState(() => _candidateId = value),
                  child: Column(
                    children: [
                      for (final raw in _data!['candidates'] as List)
                        Builder(
                          builder: (context) {
                            final candidate = Map<String, Object?>.from(
                              raw as Map,
                            );
                            final id = candidate['id'] as String;
                            return RadioListTile<String>(
                              key: ValueKey('dining-correction-$id'),
                              title: Text(candidate['name'] as String),
                              subtitle: Text(candidate['searchArea'] as String),
                              value: id,
                            );
                          },
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('submit-dining-correction'),
                  onPressed:
                      _busy ||
                          _pending != null ||
                          _candidateId == _data!['candidateId']
                      ? null
                      : _review,
                  child: const Text('변경 내용 검토'),
                ),
              ],
            ],
          ),
  );
}
