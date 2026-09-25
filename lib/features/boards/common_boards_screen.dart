import 'dart:convert';

import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

KernelJson _object(Object? value) =>
    value is Map ? Map<String, Object?>.from(value) : {};
List<KernelJson> _objects(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, Object?>.from(item))
          .toList()
    : [];
String _text(Object? value, [String fallback = '']) =>
    value is String ? value : fallback;
String _summary(Object? value) => value is String
    ? value
    : value == null
    ? ''
    : const JsonEncoder.withIndent('  ').convert(value);
String _errorText(Object error) => error is CommonKernelException
    ? error.message
    : '활동을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

String _status(Object? value) => switch (value) {
  'active' => '진행 중',
  'not_started' => '시작 전',
  'in_progress' => '진행 중',
  'waiting' => '대기 중',
  'completed' => '완료',
  'skipped' => '건너뜀',
  'canceled' => '취소됨',
  'ready' => '진행 가능',
  'blocked' => '조건 확인 필요',
  'needs_review' => '변경 확인 필요',
  _ => _text(value, '상태 미확인'),
};

final class CommonBoardsScreen extends StatefulWidget {
  const CommonBoardsScreen({this.client, super.key});
  final CommonKernelClient? client;

  @override
  State<CommonBoardsScreen> createState() => _CommonBoardsScreenState();
}

final class _CommonBoardsScreenState extends State<CommonBoardsScreen> {
  late final CommonKernelClient _client =
      widget.client ?? const HttpCommonKernelClient();
  List<KernelJson> _boards = [];
  KernelJson _contracts = {};
  Object? _error;
  bool _loading = true;
  bool _creating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final responses = await Future.wait<Object>([
        _client.contracts(),
        _client.listBoards(),
      ]);
      if (!mounted) return;
      setState(() {
        _contracts = responses[0] as KernelJson;
        _boards = responses[1] as List<KernelJson>;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(String id) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => CommonBoardScreen(
          client: _client,
          activityId: id,
          contracts: _contracts,
        ),
      ),
    );
    if (mounted) await _load();
  }

  Future<void> _create() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) => const _ActivityDraftDialog(),
    );
    if (draft == null || !mounted) return;
    setState(() => _creating = true);
    try {
      final id = 'activity-${newKernelCommandId()}';
      await _client.command({
        'commandId': newKernelCommandId(),
        'type': 'activity.create',
        'activityId': id,
        'expectedRevision': 0,
        'payload': draft,
      });
      if (mounted) await _open(id);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('공통 활동 · 개발용'),
      actions: [
        IconButton(
          key: const Key('kernel-list-refresh'),
          tooltip: '새로고침',
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: _creating ? null : _create,
      icon: const Icon(Icons.add),
      label: Text(_creating ? '만드는 중' : '활동 만들기'),
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? _ErrorPanel(message: _errorText(_error!), onRefresh: _load)
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
              children: [
                Text(
                  '등록된 분야 ${_objects(_contracts['packs']).map((pack) => _text(pack['id'])).join(' · ')}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
                if (_boards.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('아직 공통 활동이 없어요. 새 활동을 만들 수 있어요.'),
                  ),
                for (final board in _boards)
                  Card(
                    child: ListTile(
                      key: ValueKey('kernel-board-${board['id']}'),
                      title: Text(_text(board['title'], '활동')),
                      subtitle: Text(
                        '${_status(board['lifecycle'])} · 작업 ${_objects(board['tasks']).length}개',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _open(_text(board['id'])),
                    ),
                  ),
              ],
            ),
          ),
  );
}

final class CommonBoardScreen extends StatefulWidget {
  const CommonBoardScreen({
    required this.client,
    required this.activityId,
    this.contracts = const {},
    super.key,
  });
  final CommonKernelClient client;
  final String activityId;
  final KernelJson contracts;

  @override
  State<CommonBoardScreen> createState() => _CommonBoardScreenState();
}

final class _CommonBoardScreenState extends State<CommonBoardScreen> {
  KernelJson? _board;
  Object? _error;
  bool _loading = true;
  bool _busy = false;
  bool _conflict = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final board = await widget.client.getBoard(widget.activityId);
      if (!mounted) return;
      setState(() {
        _board = board;
        _conflict = false;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _change(
    String type,
    KernelJson payload, {
    bool runTask = false,
  }) async {
    if (_busy || _conflict || _board == null) return;
    final revision = _board!['revision'];
    if (revision is! int) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final commandId = newKernelCommandId();
      if (runTask) {
        await widget.client.runTask(
          activityId: widget.activityId,
          taskId: payload['taskId']! as String,
          expectedRevision: revision,
          commandId: commandId,
        );
      } else {
        await widget.client.command({
          'commandId': commandId,
          'type': type,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'payload': payload,
        });
      }
      if (mounted) await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _conflict = error is CommonKernelException && error.isRevisionConflict;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  KernelJson _capability(KernelJson task) =>
      _objects(
        widget.contracts['capabilities'],
      ).where((cap) => cap['id'] == task['capabilityId']).firstOrNull ??
      {};

  Future<void> _complete(KernelJson task) async {
    final cap = _capability(task);
    Object? output;
    if (task['outputSchema'] != null || cap['outputType'] != null) {
      final response = await showDialog<KernelJson>(
        context: context,
        builder: (_) =>
            _TaskResultDialog(outputType: _text(cap['outputType'], '결과 JSON')),
      );
      if (response == null || !mounted) return;
      output = response['output'];
      await _change('task.transition', {
        'taskId': task['id'],
        'expectedTaskRevision': task['revision'],
        'to': 'completed',
        'output': output,
      });
    } else {
      await _change('task.transition', {
        'taskId': task['id'],
        'expectedTaskRevision': task['revision'],
        'to': 'completed',
      });
    }
  }

  Widget _taskCard(KernelJson task) {
    final ready = _object(task['readiness']);
    final status = _text(task['executionStatus']);
    final cap = _capability(task);
    final system = cap['actor'] == 'system';
    final enabled = !_busy && !_conflict && _board?['lifecycle'] == 'active';
    final canProgress =
        enabled &&
        ready['status'] == 'ready' &&
        const {'not_started', 'in_progress', 'waiting'}.contains(status);
    final terminal = const {
      'completed',
      'skipped',
      'canceled',
    }.contains(status);
    final renderer = _text(task['rendererKey']);
    return Card(
      key: ValueKey('kernel-task-${task['id']}'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _text(task['title'], _text(task['id'], '작업')),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text('${_status(status)} · ${_status(ready['status'])}'),
            SelectableText(
              'ID: ${task['id']} · ${task['capabilityId']}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (renderer.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '일반 요약으로 표시 · $renderer',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            for (final reason
                in ready['reasons'] is List ? ready['reasons'] as List : [])
              Text('• $reason'),
            if (task['evidenceBindings'] is List &&
                (task['evidenceBindings'] as List).isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: SelectableText(
                  '근거 ID: ${(task['evidenceBindings'] as List).map(_summary).join(', ')}',
                ),
              ),
            _JsonDetails(
              title: '입력과 연결 정보',
              value: ready['inputs'] ?? task['inputBindings'],
            ),
            if (task['latestOutputRef'] != null)
              _JsonDetails(
                title: '최근 결과',
                value:
                    _objects(_board?['results'])
                        .where(
                          (result) => result['id'] == task['latestOutputRef'],
                        )
                        .firstOrNull ??
                    {'resultId': task['latestOutputRef']},
              ),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                if (system &&
                    cap['effect'] == 'none' &&
                    status == 'not_started')
                  FilledButton(
                    key: ValueKey('kernel-run-${task['id']}'),
                    onPressed: canProgress
                        ? () =>
                              _change('', {'taskId': task['id']}, runTask: true)
                        : null,
                    child: const Text('실행'),
                  ),
                if (!system &&
                    const {'not_started', 'waiting'}.contains(status))
                  OutlinedButton(
                    key: ValueKey('kernel-start-${task['id']}'),
                    onPressed: canProgress
                        ? () => _change('task.transition', {
                            'taskId': task['id'],
                            'expectedTaskRevision': task['revision'],
                            'to': 'in_progress',
                          })
                        : null,
                    child: const Text('시작'),
                  ),
                if (!system && !terminal)
                  FilledButton(
                    key: ValueKey('kernel-complete-${task['id']}'),
                    onPressed: canProgress ? () => _complete(task) : null,
                    child: const Text('완료'),
                  ),
                if (ready['status'] == 'needs_review')
                  OutlinedButton(
                    key: ValueKey('kernel-review-${task['id']}'),
                    onPressed: enabled
                        ? () => _change('task.resolveReview', {
                            'taskId': task['id'],
                            'expectedTaskRevision': task['revision'],
                            'resolution': 'keep_consumed',
                          })
                        : null,
                    child: const Text('이전 결과 유지'),
                  ),
                if (!terminal)
                  TextButton(
                    onPressed: enabled
                        ? () => _change('task.transition', {
                            'taskId': task['id'],
                            'expectedTaskRevision': task['revision'],
                            'to': 'skipped',
                          })
                        : null,
                    child: const Text('건너뛰기'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final board = _board;
    final tasks = _objects(board?['tasks']);
    final nextIds = board?['nextActions'] is List
        ? board!['nextActions'] as List
        : [];
    return Scaffold(
      appBar: AppBar(
        title: Text(_text(board?['title'], '공통 활동')),
        actions: [
          IconButton(
            key: const Key('kernel-board-refresh'),
            tooltip: '새로고침',
            onPressed: _loading || _busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : board == null
          ? _ErrorPanel(
              message: _errorText(_error ?? 'missing'),
              onRefresh: _load,
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_busy) const LinearProgressIndicator(),
                  if (_error != null)
                    _ErrorPanel(
                      message: _conflict
                          ? '다른 변경이 먼저 반영됐어요. 새로고침한 뒤 다시 확인해 주세요.'
                          : _errorText(_error!),
                      onRefresh: _busy ? null : _load,
                    ),
                  Text(
                    '${_status(board['lifecycle'])} · 버전 ${board['revision']}',
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _text(
                      _object(board['goal'])['description'],
                      _summary(board['goal']),
                    ),
                    key: const Key('kernel-goal'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 20),
                  Text('다음 행동', style: Theme.of(context).textTheme.titleMedium),
                  if (nextIds.isEmpty)
                    const Text('진행할 작업이 없거나 필요한 조건을 기다리고 있어요.'),
                  for (final id in nextIds)
                    Text(
                      '• ${_text(tasks.where((task) => task['id'] == id).firstOrNull?['title'], id.toString())}',
                    ),
                  if (_objects(board['pendingChanges']).isNotEmpty)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '확인할 변경 ${_objects(board['pendingChanges']).length}건',
                              key: const Key('kernel-pending-changes'),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            for (final change in _objects(
                              board['pendingChanges'],
                            ))
                              _JsonDetails(title: '변경 근거', value: change),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 16),
                  if (tasks.isEmpty) const Text('아직 작업이 없는 활동이에요.'),
                  for (final task in tasks) _taskCard(task),
                  for (final artifact in _objects(board['artifacts']))
                    Card(
                      child: _JsonDetails(
                        title: _text(
                          artifact['title'],
                          '연결된 결과물 · ${artifact['id']}',
                        ),
                        value: artifact['data'] ?? artifact,
                      ),
                    ),
                  if (board['occurrence'] != null)
                    _JsonDetails(title: '반복 회차', value: board['occurrence']),
                  if (_objects(board['reminders']).isNotEmpty)
                    _JsonDetails(title: '알림', value: board['reminders']),
                  const SizedBox(height: 28),
                ],
              ),
            ),
    );
  }
}

final class _JsonDetails extends StatelessWidget {
  const _JsonDetails({required this.title, required this.value});
  final String title;
  final Object? value;
  @override
  Widget build(BuildContext context) => ExpansionTile(
    tilePadding: EdgeInsets.zero,
    title: Text(title, style: Theme.of(context).textTheme.bodyMedium),
    children: [
      Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: SelectableText(_summary(value)),
        ),
      ),
    ],
  );
}

final class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.message, this.onRefresh});
  final String message;
  final VoidCallback? onRefresh;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(20),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(message),
        const SizedBox(height: 8),
        TextButton(onPressed: onRefresh, child: const Text('새로고침')),
      ],
    ),
  );
}

final class _ActivityDraftDialog extends StatefulWidget {
  const _ActivityDraftDialog();
  @override
  State<_ActivityDraftDialog> createState() => _ActivityDraftDialogState();
}

final class _ActivityDraftDialogState extends State<_ActivityDraftDialog> {
  final _title = TextEditingController();
  final _goal = TextEditingController();
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _title.dispose();
    _goal.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('활동 만들기'),
    content: Form(
      key: _form,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(labelText: '제목'),
              validator: (value) =>
                  value == null || value.trim().isEmpty ? '제목을 입력해 주세요.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _goal,
              decoration: const InputDecoration(labelText: '이루려는 목표'),
              maxLines: 3,
              validator: (value) =>
                  value == null || value.trim().isEmpty ? '목표를 입력해 주세요.' : null,
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
        onPressed: () {
          if (_form.currentState!.validate()) {
            Navigator.pop(context, <String, Object?>{
              'title': _title.text.trim(),
              'goal': {'description': _goal.text.trim()},
              'planDraft': {'tasks': <Object?>[]},
            });
          }
        },
        child: const Text('만들기'),
      ),
    ],
  );
}

final class _TaskResultDialog extends StatefulWidget {
  const _TaskResultDialog({required this.outputType});
  final String outputType;
  @override
  State<_TaskResultDialog> createState() => _TaskResultDialogState();
}

final class _TaskResultDialogState extends State<_TaskResultDialog> {
  final _controller = TextEditingController(text: '{}');
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('작업 결과 입력'),
    content: SizedBox(
      width: 520,
      child: Form(
        key: _form,
        child: TextFormField(
          controller: _controller,
          minLines: 5,
          maxLines: 12,
          decoration: InputDecoration(
            labelText: widget.outputType,
            helperText: '개발용 결과 입력 · 서버에서 형식과 근거를 검증해요.',
          ),
          validator: (value) {
            try {
              jsonDecode(value ?? '');
              return null;
            } on FormatException {
              return '올바른 JSON을 입력해 주세요.';
            }
          },
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        onPressed: () {
          if (_form.currentState!.validate()) {
            Navigator.pop(context, <String, Object?>{
              'output': jsonDecode(_controller.text),
            });
          }
        },
        child: const Text('완료 기록'),
      ),
    ],
  );
}
