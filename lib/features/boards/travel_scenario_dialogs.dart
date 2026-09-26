import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class TravelImportOption {
  const TravelImportOption({
    required this.importId,
    required this.name,
    required this.searchArea,
  });

  final String importId;
  final String name;
  final String searchArea;
}

String _text(Object? value) => value is String ? value : '';

DateTime? _localDateTime(String date, String time) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) ||
      !RegExp(r'^\d{2}:\d{2}$').hasMatch(time)) {
    return null;
  }
  final year = int.parse(date.substring(0, 4));
  final month = int.parse(date.substring(5, 7));
  final day = int.parse(date.substring(8, 10));
  final hour = int.parse(time.substring(0, 2));
  final minute = int.parse(time.substring(3, 5));
  final parsed = DateTime(year, month, day, hour, minute);
  if (parsed.year != year ||
      parsed.month != month ||
      parsed.day != day ||
      parsed.hour != hour ||
      parsed.minute != minute) {
    return null;
  }
  return parsed;
}

String _dateText(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

final class TravelScenarioDialog extends StatefulWidget {
  const TravelScenarioDialog({required this.options, super.key});

  final List<TravelImportOption> options;

  @override
  State<TravelScenarioDialog> createState() => _TravelScenarioDialogState();
}

final class _TravelScenarioDialogState extends State<TravelScenarioDialog> {
  final _selected = <String>{};
  final _date = TextEditingController();
  final _time = TextEditingController(text: '09:00');
  String? _area;
  String? _error;

  @override
  void initState() {
    super.initState();
    _area = widget.options.isEmpty ? null : widget.options.first.searchArea;
    _date.text = _dateText(DateTime.now().add(const Duration(days: 1)));
  }

  @override
  void dispose() {
    _date.dispose();
    _time.dispose();
    super.dispose();
  }

  void _submit() {
    final area = _area;
    final startAt = _localDateTime(_date.text.trim(), _time.text.trim());
    if (area == null ||
        area.isEmpty ||
        _selected.isEmpty ||
        _selected.length > 8 ||
        startAt == null) {
      setState(() => _error = '지역, 장소 1~8개, 날짜와 시작 시각을 확인해 주세요.');
      return;
    }
    Navigator.pop(context, <String, Object?>{
      'importIds': widget.options
          .where(
            (item) =>
                item.searchArea == area && _selected.contains(item.importId),
          )
          .map((item) => item.importId)
          .toList(),
      'area': area,
      'startAt': startAt.toUtc().toIso8601String(),
    });
  }

  @override
  Widget build(BuildContext context) {
    final areas = widget.options
        .map((item) => item.searchArea)
        .toSet()
        .toList();
    return AlertDialog(
      title: const Text('저장한 여행 장소로 하루 계획'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '원본에서 확인한 관광 장소를 고르세요. 순서와 방문 예정 시각은 계획 승인 후 직접 확정합니다.',
              ),
              DropdownButtonFormField<String>(
                key: const Key('travel-area'),
                initialValue: _area,
                decoration: const InputDecoration(labelText: '지역'),
                items: [
                  for (final area in areas)
                    DropdownMenuItem(value: area, child: Text(area)),
                ],
                onChanged: (area) => setState(() {
                  _area = area;
                  _selected.clear();
                }),
              ),
              for (final option in widget.options.where(
                (item) => item.searchArea == _area,
              ))
                CheckboxListTile(
                  key: ValueKey('travel-import-${option.importId}'),
                  contentPadding: EdgeInsets.zero,
                  value: _selected.contains(option.importId),
                  title: Text(option.name),
                  onChanged: (checked) => setState(() {
                    if (checked == true) {
                      _selected.add(option.importId);
                    } else {
                      _selected.remove(option.importId);
                    }
                  }),
                ),
              TextField(
                key: const Key('travel-date'),
                controller: _date,
                decoration: const InputDecoration(
                  labelText: '여행 날짜 (YYYY-MM-DD)',
                ),
              ),
              TextField(
                key: const Key('travel-start-time'),
                controller: _time,
                decoration: const InputDecoration(
                  labelText: '하루 시작 시각 (HH:mm)',
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
          key: const Key('travel-create-submit'),
          onPressed: _submit,
          child: const Text('계획 제안 받기'),
        ),
      ],
    );
  }
}

final class TravelConfirmDialog extends StatefulWidget {
  const TravelConfirmDialog({
    required this.candidates,
    required this.startAt,
    this.onOpenImport,
    super.key,
  });

  final List<KernelJson> candidates;
  final String startAt;
  final void Function(String importId)? onOpenImport;

  @override
  State<TravelConfirmDialog> createState() => _TravelConfirmDialogState();
}

final class _TravelConfirmDialogState extends State<TravelConfirmDialog> {
  final _included = <String>{};
  final _orderedIds = <String>[];
  final _time = <String, TextEditingController>{};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final candidate in widget.candidates) {
      final id = _text(candidate['importId']);
      if (id.isEmpty) continue;
      _orderedIds.add(id);
      _included.add(id);
      _time[id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final controller in _time.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _move(int index, int offset) {
    final target = index + offset;
    if (target < 0 || target >= _orderedIds.length) return;
    setState(() {
      final id = _orderedIds.removeAt(index);
      _orderedIds.insert(target, id);
    });
  }

  void _submit() {
    final startAt = DateTime.tryParse(widget.startAt)?.toLocal();
    if (startAt == null) {
      setState(() => _error = '여행 시작 시각을 다시 확인해 주세요.');
      return;
    }
    final selectedIds = _orderedIds.where(_included.contains).toList();
    if (selectedIds.isEmpty) {
      setState(() => _error = '방문할 장소를 하나 이상 선택해 주세요.');
      return;
    }
    final date = _dateText(startAt);
    final selections = <KernelJson>[];
    var previous = startAt.subtract(const Duration(milliseconds: 1));
    for (final id in selectedIds) {
      final plannedAt = _localDateTime(date, _time[id]?.text.trim() ?? '');
      if (plannedAt == null ||
          plannedAt.isBefore(startAt) ||
          !plannedAt.isBefore(startAt.add(const Duration(hours: 24))) ||
          !plannedAt.isAfter(previous)) {
        setState(() => _error = '모든 방문 시각을 하루 시작 이후, 24시간 안에서 순서대로 입력해 주세요.');
        return;
      }
      selections.add({
        'importId': id,
        'plannedAt': plannedAt.toUtc().toIso8601String(),
      });
      previous = plannedAt;
    }
    Navigator.pop(context, selections);
  }

  @override
  Widget build(BuildContext context) {
    final candidates = {
      for (final candidate in widget.candidates)
        _text(candidate['importId']): candidate,
    };
    final start = DateTime.tryParse(widget.startAt)?.toLocal();
    return AlertDialog(
      title: const Text('방문 순서와 시각 확인'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '시작: ${start == null ? '확인 필요' : '${_dateText(start)} ${start.hour.toString().padLeft(2, '0')}:${start.minute.toString().padLeft(2, '0')}'}',
              ),
              const Text(
                '장소 이름은 캡처에서 읽은 후보입니다. 원본을 보고 순서와 각 방문 예정 시각을 직접 확정해 주세요. 이동시간·영업시간은 아직 확인되지 않았어요.',
              ),
              for (var index = 0; index < _orderedIds.length; index++)
                Builder(
                  builder: (context) {
                    final id = _orderedIds[index];
                    final candidate = candidates[id] ?? {};
                    final selectedIndex = _orderedIds
                        .take(index + 1)
                        .where(_included.contains)
                        .length;
                    return Card(
                      key: ValueKey('travel-stop-card-$id'),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            CheckboxListTile(
                              key: ValueKey('travel-confirm-include-$id'),
                              value: _included.contains(id),
                              title: Text(
                                _included.contains(id)
                                    ? '$selectedIndex. ${_text(candidate['name'])}'
                                    : '${_text(candidate['name'])} · 제외',
                              ),
                              subtitle: Text(_text(candidate['searchArea'])),
                              onChanged: (checked) => setState(() {
                                if (checked == true) {
                                  _included.add(id);
                                } else {
                                  _included.remove(id);
                                }
                              }),
                            ),
                            if (_included.contains(id)) ...[
                              Wrap(
                                children: [
                                  IconButton(
                                    key: ValueKey('travel-stop-up-$id'),
                                    tooltip: '앞 장소로 이동',
                                    onPressed: index == 0
                                        ? null
                                        : () => _move(index, -1),
                                    icon: const Icon(Icons.arrow_upward),
                                  ),
                                  IconButton(
                                    key: ValueKey('travel-stop-down-$id'),
                                    tooltip: '뒤 장소로 이동',
                                    onPressed: index == _orderedIds.length - 1
                                        ? null
                                        : () => _move(index, 1),
                                    icon: const Icon(Icons.arrow_downward),
                                  ),
                                  if (widget.onOpenImport != null)
                                    TextButton.icon(
                                      key: ValueKey('travel-source-$id'),
                                      onPressed: () => widget.onOpenImport!(id),
                                      icon: const Icon(Icons.image_outlined),
                                      label: const Text('원본 캡처 보기'),
                                    ),
                                ],
                              ),
                              TextField(
                                key: ValueKey('travel-stop-time-$id'),
                                controller: _time[id],
                                decoration: const InputDecoration(
                                  labelText: '방문 예정 시각 (HH:mm)',
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  },
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
          key: const Key('travel-confirm-submit'),
          onPressed: _submit,
          child: const Text('하루 일정 확정'),
        ),
      ],
    );
  }
}

final class TravelOutcomeDialog extends StatefulWidget {
  const TravelOutcomeDialog({required this.stops, super.key});

  final List<KernelJson> stops;

  @override
  State<TravelOutcomeDialog> createState() => _TravelOutcomeDialogState();
}

final class _TravelOutcomeDialogState extends State<TravelOutcomeDialog> {
  final _statusByStop = <String, String>{};
  String? _error;

  void _submit() {
    if (widget.stops.isEmpty ||
        widget.stops.any(
          (stop) => !_statusByStop.containsKey(_text(stop['id'])),
        )) {
      setState(() => _error = '모든 장소의 방문 여부를 선택해 주세요.');
      return;
    }
    Navigator.pop(context, [
      for (final stop in widget.stops)
        <String, Object?>{
          'stopId': stop['id'],
          'status': _statusByStop[_text(stop['id'])],
        },
    ]);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 방문 결과 기록'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('일정에 넣은 것과 실제 방문은 별도예요. 장소마다 직접 기록해 주세요.'),
            for (final stop in widget.stops)
              DropdownButtonFormField<String>(
                key: ValueKey('travel-outcome-${stop['id']}'),
                initialValue: _statusByStop[_text(stop['id'])],
                decoration: InputDecoration(labelText: _text(stop['title'])),
                items: const [
                  DropdownMenuItem(value: 'visited', child: Text('다녀왔어요')),
                  DropdownMenuItem(value: 'skipped', child: Text('못 갔어요')),
                  DropdownMenuItem(value: 'unknown', child: Text('아직 몰라요')),
                ],
                onChanged: (value) => setState(() {
                  if (value != null) _statusByStop[_text(stop['id'])] = value;
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
        key: const Key('travel-outcome-submit'),
        onPressed: _submit,
        child: const Text('방문 결과 저장'),
      ),
    ],
  );
}
