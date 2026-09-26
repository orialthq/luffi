import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class HealthImportOption {
  const HealthImportOption({required this.importId, required this.title});
  final String importId;
  final String title;
}

String _text(Object? value) => value is String ? value : '';

final class HealthScenarioDialog extends StatefulWidget {
  const HealthScenarioDialog({required this.options, super.key});
  final List<HealthImportOption> options;
  @override
  State<HealthScenarioDialog> createState() => _HealthScenarioDialogState();
}

final class _HealthScenarioDialogState extends State<HealthScenarioDialog> {
  String? _selectedId;
  String? _error;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 운동 계획으로 시작'),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('원본을 확인해 저장한 단계형 운동 화면 하나를 고르세요. 실제 수행은 별도로 기록합니다.'),
            for (final option in widget.options)
              ListTile(
                key: ValueKey('health-import-${option.importId}'),
                selected: _selectedId == option.importId,
                leading: Icon(
                  _selectedId == option.importId
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                ),
                title: Text(option.title),
                onTap: () => setState(() => _selectedId = option.importId),
              ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        key: const Key('health-create-submit'),
        onPressed: () {
          if (_selectedId == null) {
            setState(() => _error = '운동 화면 하나를 선택해 주세요.');
            return;
          }
          Navigator.pop(context, _selectedId);
        },
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class HealthConfirmDialog extends StatefulWidget {
  const HealthConfirmDialog({
    required this.title,
    required this.importId,
    required this.candidates,
    this.onOpenImport,
    super.key,
  });
  final String title;
  final String importId;
  final List<KernelJson> candidates;
  final void Function(String importId)? onOpenImport;
  @override
  State<HealthConfirmDialog> createState() => _HealthConfirmDialogState();
}

final class _HealthConfirmDialogState extends State<HealthConfirmDialog> {
  final _selected = <int>{};
  String? _error;
  @override
  void initState() {
    super.initState();
    for (final candidate in widget.candidates) {
      if (candidate['factIndex'] case final int index) _selected.add(index);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('이번에 할 운동 항목 확인'),
    content: SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const Text('캡처에서 읽은 목표 문구입니다. 수행했다고 기록되는 것은 아닙니다.'),
            if (widget.onOpenImport != null)
              TextButton.icon(
                key: const Key('health-open-source'),
                onPressed: () => widget.onOpenImport!(widget.importId),
                icon: const Icon(Icons.image_outlined),
                label: const Text('원본 캡처 보기'),
              ),
            for (final candidate in widget.candidates)
              CheckboxListTile(
                key: ValueKey('health-fact-${candidate['factIndex']}'),
                contentPadding: EdgeInsets.zero,
                value: _selected.contains(candidate['factIndex']),
                title: Text(
                  '${candidate['factIndex']}. ${_text(candidate['text'])}',
                ),
                onChanged: (checked) => setState(() {
                  final index = candidate['factIndex'];
                  if (index is! int) return;
                  if (checked == true) {
                    _selected.add(index);
                  } else {
                    _selected.remove(index);
                  }
                }),
              ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        key: const Key('health-confirm-submit'),
        onPressed: () {
          if (_selected.isEmpty) {
            setState(() => _error = '운동 항목을 하나 이상 선택해 주세요.');
            return;
          }
          Navigator.pop(context, _selected.toList()..sort());
        },
        child: const Text('운동 계획 확정'),
      ),
    ],
  );
}

final class HealthOutcomeDialog extends StatefulWidget {
  const HealthOutcomeDialog({required this.exercises, super.key});
  final List<KernelJson> exercises;
  @override
  State<HealthOutcomeDialog> createState() => _HealthOutcomeDialogState();
}

final class _HealthOutcomeDialogState extends State<HealthOutcomeDialog> {
  final _statuses = <String, String>{};
  final _amounts = <String, TextEditingController>{};
  final _units = <String, String>{};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final item in widget.exercises) {
      final id = _text(item['id']);
      _statuses[id] = 'unknown';
      _amounts[id] = TextEditingController();
      _units[id] = _text(item['text']).contains('분')
          ? 'minutes'
          : 'repetitions';
    }
  }

  @override
  void dispose() {
    for (final controller in _amounts.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 운동 결과 기록'),
    content: SizedBox(
      width: 500,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('계획 문구와 실제 수행량은 다를 수 있습니다. 직접 한 항목만 수행량을 적어 주세요.'),
            for (final exercise in widget.exercises)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _text(exercise['text']),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      DropdownButton<String>(
                        key: ValueKey('health-status-${exercise['id']}'),
                        value: _statuses[_text(exercise['id'])],
                        isExpanded: true,
                        items: const [
                          DropdownMenuItem(value: 'done', child: Text('했어요')),
                          DropdownMenuItem(
                            value: 'skipped',
                            child: Text('하지 않았어요'),
                          ),
                          DropdownMenuItem(
                            value: 'unknown',
                            child: Text('아직 몰라요'),
                          ),
                        ],
                        onChanged: (value) => setState(
                          () => _statuses[_text(exercise['id'])] = value!,
                        ),
                      ),
                      if (_statuses[_text(exercise['id'])] == 'done')
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                key: ValueKey(
                                  'health-amount-${exercise['id']}',
                                ),
                                controller: _amounts[_text(exercise['id'])],
                                keyboardType: TextInputType.number,
                                decoration: const InputDecoration(
                                  labelText: '실제 수행량',
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            DropdownButton<String>(
                              key: ValueKey('health-unit-${exercise['id']}'),
                              value: _units[_text(exercise['id'])],
                              items: const [
                                DropdownMenuItem(
                                  value: 'minutes',
                                  child: Text('분'),
                                ),
                                DropdownMenuItem(
                                  value: 'repetitions',
                                  child: Text('회'),
                                ),
                              ],
                              onChanged: (value) => setState(
                                () => _units[_text(exercise['id'])] = value!,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        key: const Key('health-outcome-submit'),
        onPressed: () {
          final outcomes = <KernelJson>[];
          for (final exercise in widget.exercises) {
            final id = _text(exercise['id']);
            final status = _statuses[id]!;
            if (status != 'done') {
              outcomes.add({'exerciseId': id, 'status': status});
              continue;
            }
            final amount = int.tryParse(_amounts[id]!.text.trim());
            final unit = _units[id]!;
            if (amount == null ||
                amount < 1 ||
                amount > 10000 ||
                (unit == 'minutes' && amount > 1440)) {
              setState(() => _error = '실제로 한 운동의 수행량을 확인해 주세요.');
              return;
            }
            outcomes.add({
              'exerciseId': id,
              'status': status,
              'actualAmount': amount,
              'actualUnit': unit,
            });
          }
          Navigator.pop(context, outcomes);
        },
        child: const Text('결과 기록'),
      ),
    ],
  );
}
