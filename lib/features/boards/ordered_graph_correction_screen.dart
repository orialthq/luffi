import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

/// Edits the current graph projection while preserving the confirmed task result.
final class OrderedGraphCorrectionScreen extends StatefulWidget {
  const OrderedGraphCorrectionScreen({
    required this.client,
    required this.activityId,
    required this.scenario,
    super.key,
  }) : assert(scenario == 'beauty' || scenario == 'travel');

  final CommonKernelClient client;
  final String activityId;
  final String scenario;

  @override
  State<OrderedGraphCorrectionScreen> createState() =>
      _OrderedGraphCorrectionScreenState();
}

final class _GraphRow {
  _GraphRow(KernelJson value, bool beauty)
    : id = value['id'] as String,
      label = value['title'] as String,
      text = TextEditingController(
        text: beauty ? value['title'] as String : value['plannedAt'] as String,
      ),
      variantId = beauty ? value['variantId'] as String : null;

  final String id;
  final String label;
  final TextEditingController text;
  String? variantId;

  void dispose() => text.dispose();
}

final class _OrderedGraphCorrectionScreenState
    extends State<OrderedGraphCorrectionScreen> {
  final _allRows = <_GraphRow>[];
  final _rows = <_GraphRow>[];
  final _variantLabels = <String, String>{};
  KernelJson? _data;
  KernelJson? _pending;
  Object? _error;
  bool _busy = false;

  bool get _beauty => widget.scenario == 'beauty';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final row in _allRows) {
      row.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = _beauty
          ? await widget.client.getEditableBeautyRoutine(widget.activityId)
          : await widget.client.getEditableTravelItinerary(widget.activityId);
      if (!mounted) return;
      _rows.clear();
      _variantLabels.clear();
      for (final raw in data[_beauty ? 'steps' : 'stops'] as List) {
        final row = _GraphRow(Map<String, Object?>.from(raw as Map), _beauty);
        _allRows.add(row);
        _rows.add(row);
        if (row.variantId != null) _variantLabels[row.variantId!] = row.label;
      }
      setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _move(int index, int by) {
    final destination = index + by;
    if (destination < 0 || destination >= _rows.length) return;
    setState(() => _rows.insert(destination, _rows.removeAt(index)));
  }

  List<KernelJson>? _changes() {
    if (_beauty) {
      final changes = <KernelJson>[];
      for (final row in _rows) {
        final title = row.text.text.trim();
        if (title.isEmpty || title.length > 100 || row.variantId == null) {
          setState(() => _error = '단계 문구와 제품 연결을 확인해 주세요.');
          return null;
        }
        changes.add({'id': row.id, 'title': title, 'variantId': row.variantId});
      }
      return changes;
    }
    final start = DateTime.tryParse(_data!['startAt'] as String);
    DateTime? previous;
    final changes = <KernelJson>[];
    for (final row in _rows) {
      final value = row.text.text.trim();
      final time = DateTime.tryParse(value);
      if (start == null ||
          time == null ||
          time.isBefore(start) ||
          !time.isBefore(start.add(const Duration(hours: 24))) ||
          (previous != null && !time.isAfter(previous))) {
        setState(() => _error = '방문 시각을 시작 후 24시간 안에서 순서대로 입력해 주세요.');
        return null;
      }
      previous = time;
      changes.add({'id': row.id, 'plannedAt': value});
    }
    return changes;
  }

  Future<void> _review() async {
    if (_data == null || _busy || _pending != null) return;
    final changes = _changes();
    if (changes == null) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_beauty ? '뷰티 루틴 정정 확인' : '여행 일정 정정 확인'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final entry in changes.asMap().entries)
                Text(
                  _beauty
                      ? '${entry.key + 1}. ${entry.value['title']}'
                      : '${entry.key + 1}. ${_rows[entry.key].label} · ${entry.value['plannedAt']}',
                ),
              const SizedBox(height: 12),
              const Text('기존에 완료한 작업은 보존됩니다. 변경된 계획은 새 활동에서 다시 확인해요.'),
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
      'expectedGraphFingerprint': _data!['graphFingerprint'],
      _beauty ? 'steps' : 'stops': changes,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pending;
    if (request == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_beauty) {
        await widget.client.correctBeautyRoutine(request);
      } else {
        await widget.client.correctTravelItinerary(request);
      }
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
    appBar: AppBar(title: Text(_beauty ? '뷰티 루틴 정정' : '여행 일정 정정')),
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
                const Text('아래의 현재 그래프를 정정합니다. 처음 확정한 결과는 보존됩니다.'),
                ExpansionTile(
                  title: const Text('처음 확정한 내용 보기'),
                  children: [
                    for (final raw
                        in _data![_beauty ? 'originalSteps' : 'originalStops']
                            as List)
                      ListTile(title: Text('${(raw as Map)['title']}')),
                  ],
                ),
                for (final entry in _rows.asMap().entries)
                  Card(
                    key: ValueKey('graph-row-${entry.value.id}'),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '${entry.key + 1}. ${entry.value.label}',
                                ),
                              ),
                              IconButton(
                                tooltip: '위로',
                                onPressed: _busy || entry.key == 0
                                    ? null
                                    : () => _move(entry.key, -1),
                                icon: const Icon(Icons.arrow_upward),
                              ),
                              IconButton(
                                tooltip: '아래로',
                                onPressed:
                                    _busy || entry.key == _rows.length - 1
                                    ? null
                                    : () => _move(entry.key, 1),
                                icon: const Icon(Icons.arrow_downward),
                              ),
                            ],
                          ),
                          TextField(
                            controller: entry.value.text,
                            maxLength: _beauty ? 100 : null,
                            decoration: InputDecoration(
                              labelText: _beauty
                                  ? '단계 문구'
                                  : '방문 시각 (ISO 8601, 시간대 포함)',
                            ),
                          ),
                          if (_beauty)
                            DropdownButtonFormField<String>(
                              initialValue: entry.value.variantId,
                              decoration: const InputDecoration(
                                labelText: '연결할 제품',
                              ),
                              items: _variantLabels.entries
                                  .map(
                                    (choice) => DropdownMenuItem(
                                      value: choice.key,
                                      child: Text(choice.value),
                                    ),
                                  )
                                  .toList(),
                              onChanged: _busy
                                  ? null
                                  : (value) => setState(
                                      () => entry.value.variantId = value,
                                    ),
                            ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('submit-ordered-graph-correction'),
                  onPressed: _busy || _pending != null ? null : _review,
                  child: const Text('변경 내용 검토'),
                ),
              ],
            ],
          ),
  );
}
