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
    : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

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
  bool _contractsUnavailable = false;
  String? _nextCursor;
  Object? _error;
  Object? _pageError;
  bool _loading = true;
  bool _loadingMore = false;
  bool _creating = false;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    setState(() {
      _loading = true;
      _error = null;
      _pageError = null;
      _loadingMore = false;
    });
    try {
      // Board summaries can still be browsed when contract metadata is down.
      // An empty contract set makes the detail screen read-only.
      final contractsFuture = _client.contracts().then<KernelJson?>(
        (contracts) => contracts,
        onError: (Object _) => null,
      );
      final page = await _client.listBoardsPage();
      final contracts = await contractsFuture;
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _contracts = contracts ?? {};
        _contractsUnavailable = contracts == null;
        _boards = page.boards;
        _nextCursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted && generation == _loadGeneration) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted && generation == _loadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (_loading || _loadingMore || cursor == null) return;
    final generation = _loadGeneration;
    setState(() {
      _loadingMore = true;
      _pageError = null;
    });
    try {
      final page = await _client.listBoardsPage(cursor: cursor);
      if (!mounted || generation != _loadGeneration) return;
      final seen = _boards.map((board) => board['id']).toSet();
      setState(() {
        _boards = [
          ..._boards,
          ...page.boards.where((board) => seen.add(board['id'])),
        ];
        _nextCursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted && generation == _loadGeneration) {
        setState(() => _pageError = error);
      }
    } finally {
      if (mounted && generation == _loadGeneration) {
        setState(() => _loadingMore = false);
      }
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
      onPressed: _creating || _loading ? null : _create,
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
                if (_contractsUnavailable)
                  const Text('실행 계약을 불러오지 못해 작업은 읽기 전용으로 열려요.'),
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
                        '${_status(board['lifecycle'])} · 작업 ${board['taskCount']}개',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _open(_text(board['id'])),
                    ),
                  ),
                if (_pageError != null)
                  _ErrorPanel(
                    message: _errorText(_pageError!),
                    onRefresh: _loadMore,
                  ),
                if (_nextCursor != null && _pageError == null)
                  Center(
                    child: TextButton(
                      key: const Key('kernel-list-more'),
                      onPressed: _loadingMore ? null : _loadMore,
                      child: Text(_loadingMore ? '불러오는 중' : '활동 더 보기'),
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
  bool _needsRefresh = false;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool afterMutation = false}) async {
    if (_busy && !afterMutation) return;
    final generation = ++_loadGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final board = await widget.client.getBoard(widget.activityId);
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _board = board;
        _needsRefresh = false;
      });
    } catch (error) {
      if (mounted && generation == _loadGeneration) {
        setState(() {
          _error = error;
          // Keep the last board visible, but its revision cannot be trusted
          // until a successful refresh has checked the current server state.
          _needsRefresh = true;
        });
      }
    } finally {
      if (mounted && generation == _loadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _mutate(
    Future<void> Function(int revision, String commandId) action,
  ) async {
    if (_busy || _needsRefresh || _board == null) return;
    final revision = _board!['revision'];
    if (revision is! int) {
      setState(() {
        _needsRefresh = true;
        _error = const CommonKernelException(
          'INVALID_RESPONSE',
          '활동의 버전을 확인할 수 없어요. 새로고침해 주세요.',
        );
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action(revision, newKernelCommandId());
      if (mounted) await _load(afterMutation: true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        // A failed response does not prove that the server rejected the write.
        // The command may have committed before the connection was lost.
        _needsRefresh = true;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _command(String type, KernelJson payload) =>
      _mutate((revision, commandId) async {
        await widget.client.command({
          'commandId': commandId,
          'type': type,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'payload': payload,
        });
      });

  Future<void> _runTask(String taskId) => _mutate((revision, commandId) async {
    await widget.client.runTask(
      activityId: widget.activityId,
      taskId: taskId,
      expectedRevision: revision,
      commandId: commandId,
    );
  });

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
      await _command('task.transition', {
        'taskId': task['id'],
        'expectedTaskRevision': task['revision'],
        'to': 'completed',
        'output': output,
      });
    } else {
      await _command('task.transition', {
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
    final enabled =
        !_busy &&
        !_needsRefresh &&
        cap.isNotEmpty &&
        _board?['lifecycle'] == 'active';
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
            if (cap.isEmpty) const Text('이 작업의 실행 계약을 확인할 수 없어 읽기 전용으로 표시해요.'),
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
                        ? () => _runTask(_text(task['id']))
                        : null,
                    child: const Text('실행'),
                  ),
                if (!system &&
                    const {'not_started', 'waiting'}.contains(status))
                  OutlinedButton(
                    key: ValueKey('kernel-start-${task['id']}'),
                    onPressed: canProgress
                        ? () => _command('task.transition', {
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
                        ? () => _command('task.resolveReview', {
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
                        ? () => _command('task.transition', {
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

  Widget _overview(KernelJson board, List<KernelJson> tasks) {
    final nextIds = board['nextActions'] is List
        ? board['nextActions'] as List
        : const [];
    final titlesById = {
      for (final task in tasks)
        if (task['id'] is String) task['id'] as String: _text(task['title']),
    };
    final pendingChanges = _objects(board['pendingChanges']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_busy) const LinearProgressIndicator(),
        if (_error != null)
          _ErrorPanel(
            message:
                _error is CommonKernelException &&
                    (_error as CommonKernelException).isRevisionConflict
                ? '활동 또는 연결된 정보가 변경됐어요. 새로고침한 뒤 다시 확인해 주세요.'
                : _errorText(_error!),
            onRefresh: _busy ? null : _load,
          ),
        Text(
          '${_status(board['lifecycle'])} · 버전 ${board['revision']}',
          style: Theme.of(context).textTheme.labelLarge,
        ),
        const SizedBox(height: 8),
        Text(
          _text(_object(board['goal'])['description'], _summary(board['goal'])),
          key: const Key('kernel-goal'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 20),
        Text('다음 행동', style: Theme.of(context).textTheme.titleMedium),
        if (nextIds.isEmpty) const Text('진행할 작업이 없거나 필요한 조건을 기다리고 있어요.'),
        for (final id in nextIds) Text('• ${titlesById[id] ?? id.toString()}'),
        if (pendingChanges.isNotEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '확인할 변경 ${pendingChanges.length}건',
                    key: const Key('kernel-pending-changes'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  for (final change in pendingChanges)
                    _JsonDetails(title: '변경 근거', value: change),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        if (tasks.isEmpty) const Text('아직 작업이 없는 활동이에요.'),
      ],
    );
  }

  Widget _artifactCard(KernelJson artifact) => Card(
    child: _JsonDetails(
      title: _text(artifact['title'], '연결된 결과물 · ${artifact['id']}'),
      value: artifact['data'] ?? artifact,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final board = _board;
    final tasks = _objects(board?['tasks']);
    final artifacts = _objects(board?['artifacts']);
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
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                    sliver: SliverToBoxAdapter(child: _overview(board, tasks)),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) => _taskCard(tasks[index]),
                        childCount: tasks.length,
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) => _artifactCard(artifacts[index]),
                        childCount: artifacts.length,
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
                    sliver: SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (board['occurrence'] != null)
                            _JsonDetails(
                              title: '반복 회차',
                              value: board['occurrence'],
                            ),
                          if (_objects(board['reminders']).isNotEmpty)
                            _JsonDetails(
                              title: '알림',
                              value: board['reminders'],
                            ),
                        ],
                      ),
                    ),
                  ),
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
