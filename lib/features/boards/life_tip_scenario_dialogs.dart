import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class LifeTipImportOption {
  const LifeTipImportOption({required this.importId, required this.title});

  final String importId;
  final String title;
}

String _text(Object? value) => value is String ? value : '';

final class LifeTipScenarioDialog extends StatefulWidget {
  const LifeTipScenarioDialog({required this.options, super.key});

  final List<LifeTipImportOption> options;

  @override
  State<LifeTipScenarioDialog> createState() => _LifeTipScenarioDialogState();
}

final class _LifeTipScenarioDialogState extends State<LifeTipScenarioDialog> {
  String? _selectedId;
  String? _error;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 생활 꿀팁으로 시작'),
    content: SizedBox(
      width: 420,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('원본을 확인해 저장한 단계형 꿀팁 하나를 고르세요. 실천할 단계는 계획 승인 후 선택합니다.'),
            for (final option in widget.options)
              ListTile(
                key: ValueKey('life-tip-import-${option.importId}'),
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
        key: const Key('life-tip-create-submit'),
        onPressed: () {
          if (_selectedId == null) {
            setState(() => _error = '생활 꿀팁 하나를 선택해 주세요.');
            return;
          }
          Navigator.pop(context, _selectedId);
        },
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class LifeTipConfirmDialog extends StatefulWidget {
  const LifeTipConfirmDialog({
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
  State<LifeTipConfirmDialog> createState() => _LifeTipConfirmDialogState();
}

final class _LifeTipConfirmDialogState extends State<LifeTipConfirmDialog> {
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
    title: const Text('실천할 단계 확인'),
    content: SizedBox(
      width: 460,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const Text(
              '화면에서 읽은 조언입니다. 원본을 보고 이번에 실천할 단계만 선택해 주세요. 선택만으로 실행한 것으로 기록되지 않아요.',
            ),
            if (widget.onOpenImport != null)
              TextButton.icon(
                key: const Key('life-tip-open-source'),
                onPressed: () => widget.onOpenImport!(widget.importId),
                icon: const Icon(Icons.image_outlined),
                label: const Text('원본 캡처 보기'),
              ),
            for (final candidate in widget.candidates)
              CheckboxListTile(
                key: ValueKey('life-tip-fact-${candidate['factIndex']}'),
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
        key: const Key('life-tip-confirm-submit'),
        onPressed: () {
          if (_selected.isEmpty) {
            setState(() => _error = '실천할 단계를 하나 이상 선택해 주세요.');
            return;
          }
          Navigator.pop(context, _selected.toList()..sort());
        },
        child: const Text('실천 계획 확정'),
      ),
    ],
  );
}

final class LifeTipOutcomeDialog extends StatefulWidget {
  const LifeTipOutcomeDialog({required this.actions, super.key});

  final List<KernelJson> actions;

  @override
  State<LifeTipOutcomeDialog> createState() => _LifeTipOutcomeDialogState();
}

final class _LifeTipOutcomeDialogState extends State<LifeTipOutcomeDialog> {
  final _statusByAction = <String, String>{};
  String? _error;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 실행 결과 기록'),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('계획만 세운 단계는 완료가 아니에요. 각 단계의 실제 결과를 직접 골라 주세요.'),
            for (final action in widget.actions)
              DropdownButtonFormField<String>(
                key: ValueKey('life-tip-outcome-${action['id']}'),
                initialValue: _statusByAction[_text(action['id'])],
                decoration: InputDecoration(labelText: _text(action['text'])),
                items: const [
                  DropdownMenuItem(value: 'done', child: Text('했어요')),
                  DropdownMenuItem(value: 'skipped', child: Text('하지 않았어요')),
                  DropdownMenuItem(value: 'unknown', child: Text('아직 몰라요')),
                ],
                onChanged: (value) => setState(() {
                  if (value != null) {
                    _statusByAction[_text(action['id'])] = value;
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
        key: const Key('life-tip-outcome-submit'),
        onPressed: () {
          if (widget.actions.isEmpty ||
              widget.actions.any(
                (action) => !_statusByAction.containsKey(_text(action['id'])),
              )) {
            setState(() => _error = '모든 단계의 실행 결과를 선택해 주세요.');
            return;
          }
          Navigator.pop(context, [
            for (final action in widget.actions)
              <String, Object?>{
                'actionId': action['id'],
                'status': _statusByAction[_text(action['id'])],
              },
          ]);
        },
        child: const Text('실행 결과 저장'),
      ),
    ],
  );
}
