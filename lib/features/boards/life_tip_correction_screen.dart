import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class LifeTipCorrectionScreen extends StatefulWidget {
  const LifeTipCorrectionScreen({
    required this.client,
    required this.activityId,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;

  @override
  State<LifeTipCorrectionScreen> createState() =>
      _LifeTipCorrectionScreenState();
}

final class _LifeTipCorrectionScreenState
    extends State<LifeTipCorrectionScreen> {
  KernelJson? _data;
  KernelJson? _pending;
  final _order = <int>[];
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
      final data = await widget.client.getEditableLifeTipPlan(
        widget.activityId,
      );
      if (!mounted) return;
      setState(() {
        _data = data;
        _order
          ..clear()
          ..addAll(
            (data['actions'] as List).map(
              (raw) => (raw as Map)['factIndex'] as int,
            ),
          );
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _textFor(int factIndex) {
    final candidates = (_data?['candidates'] as List).whereType<Map>();
    return candidates.firstWhere(
          (item) => item['factIndex'] == factIndex,
        )['text']
        as String;
  }

  void _move(int from, int to) {
    if (_busy || _pending != null || to < 0 || to >= _order.length) return;
    setState(() {
      final item = _order.removeAt(from);
      _order.insert(to, item);
    });
  }

  Future<void> _review() async {
    final data = _data;
    if (_busy || data == null || _pending != null) return;
    if (_order.isEmpty) {
      setState(() => _error = '실천할 단계는 적어도 하나 남겨야 해요.');
      return;
    }
    final original = (data['actions'] as List)
        .map((raw) => (raw as Map)['factIndex'] as int)
        .toList();
    if (_order.length == original.length &&
        List.generate(
          _order.length,
          (index) => _order[index] == original[index],
        ).every((equal) => equal)) {
      setState(() => _error = '변경된 단계가 없어요.');
      return;
    }
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('꿀팁 단계 정정 확인'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final entry in _order.asMap().entries)
                Text('${entry.key + 1}. ${_textFor(entry.value)}'),
              const SizedBox(height: 12),
              const Text('기존 실행 기록은 당시 단계에 남습니다. 변경된 계획은 새 활동에서 다시 확인해요.'),
            ],
          ),
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
      'factIndexes': [..._order],
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
      await widget.client.correctLifeTipPlan(request);
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
    appBar: AppBar(title: const Text('꿀팁 단계·순서 정정')),
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
                const Text('캡처에 있는 단계만 추가할 수 있어요. 선택한 단계의 순서를 조정하세요.'),
                const SizedBox(height: 12),
                for (final entry in _order.asMap().entries)
                  Card(
                    key: ValueKey('life-tip-selected-${entry.value}'),
                    child: ListTile(
                      title: Text('${entry.key + 1}. ${_textFor(entry.value)}'),
                      trailing: Wrap(
                        children: [
                          IconButton(
                            tooltip: '위로 이동',
                            onPressed: _busy || entry.key == 0
                                ? null
                                : () => _move(entry.key, entry.key - 1),
                            icon: const Icon(Icons.arrow_upward),
                          ),
                          IconButton(
                            tooltip: '아래로 이동',
                            onPressed: _busy || entry.key == _order.length - 1
                                ? null
                                : () => _move(entry.key, entry.key + 1),
                            icon: const Icon(Icons.arrow_downward),
                          ),
                          IconButton(
                            tooltip: '단계 제외',
                            onPressed: _busy || _pending != null
                                ? null
                                : () => setState(
                                    () => _order.remove(entry.value),
                                  ),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                for (final raw in _data!['candidates'] as List)
                  if (!_order.contains((raw as Map)['factIndex']))
                    TextButton.icon(
                      key: ValueKey('life-tip-add-${raw['factIndex']}'),
                      onPressed: _busy || _pending != null
                          ? null
                          : () => setState(
                              () => _order.add(raw['factIndex'] as int),
                            ),
                      icon: const Icon(Icons.add),
                      label: Text(raw['text'] as String),
                    ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('submit-life-tip-correction'),
                  onPressed: _busy || _pending != null ? null : _review,
                  child: const Text('변경 내용 검토'),
                ),
              ],
            ],
          ),
  );
}
