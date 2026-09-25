import 'dart:async';
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
List<String> _strings(Object? value) =>
    value is List ? value.whereType<String>().toList() : [];
Object? _taskInputs(KernelJson task) {
  final resolved = _object(_object(task['readiness'])['inputs']);
  return resolved.isEmpty ? task['inputBindings'] : resolved;
}

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

String _quantity(Object? raw) {
  final value = _object(raw);
  return switch (value['status']) {
    'known' => '${value['amount']} ${_text(value['unit'])}',
    'as_needed' => '적당량',
    _ => '확인 필요',
  };
}

String _requirementStatus(Object? status) => switch (status) {
  'needed' => '추가로 필요',
  'satisfied' => '재고 충분',
  'incompatible_unit' => '단위 확인 필요',
  'as_needed' => '적당량',
  _ => '재고 확인 필요',
};

bool _isRecipeBoard(KernelJson board) =>
    board['scenarioType'] == 'recipe' ||
    _objects(
      board['tasks'],
    ).any((task) => _text(task['capabilityId']).startsWith('recipe.')) ||
    _objects(board['pendingProposals']).any(
      (proposal) => _objects(
        _object(proposal['plan'])['tasks'],
      ).any((task) => _text(task['capabilityId']).startsWith('recipe.')),
    );

final class CommonBoardsScreen extends StatefulWidget {
  const CommonBoardsScreen({
    this.client,
    this.intentStore,
    this.importOptions = const [],
    super.key,
  });
  final CommonKernelClient? client;
  final RecipeScenarioIntentStore? intentStore;
  final List<RecipeImportOption> importOptions;

  @override
  State<CommonBoardsScreen> createState() => _CommonBoardsScreenState();
}

/// An already synced, explicitly reviewed capture that can be linked to a
/// user-entered recipe. The import itself does not assert ingredient amounts.
final class RecipeImportOption {
  const RecipeImportOption({required this.importId, required this.title});

  final String importId;
  final String title;
}

final class _CommonBoardsScreenState extends State<CommonBoardsScreen> {
  late final CommonKernelClient _client =
      widget.client ?? const HttpCommonKernelClient();
  late final RecipeScenarioIntentStore _intentStore =
      widget.intentStore ?? const FileRecipeScenarioIntentStore();
  List<KernelJson> _boards = [];
  KernelJson _contracts = {};
  bool _contractsUnavailable = false;
  String? _nextCursor;
  Object? _error;
  Object? _pageError;
  bool _loading = true;
  bool _loadingMore = false;
  bool _creating = false;
  bool _creatingRecipe = false;
  bool _intentLoading = true;
  KernelJson? _pendingRecipeIntent;
  Object? _intentError;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
    unawaited(_loadRecipeIntent());
  }

  Future<void> _loadRecipeIntent() async {
    setState(() {
      _intentLoading = true;
      _intentError = null;
    });
    try {
      final pending = await _intentStore.load();
      if (mounted) setState(() => _pendingRecipeIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _intentError = error);
    } finally {
      if (mounted) setState(() => _intentLoading = false);
    }
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

  Future<void> _createSampleRecipe() async {
    final targetServings = await showDialog<int>(
      context: context,
      builder: (_) => const _SampleRecipeDialog(),
    );
    if (targetServings == null || !mounted) return;
    await _submitRecipe(
      title: '토마토 달걀 볶음 · 샘플',
      baseServings: 2,
      targetServings: targetServings,
      ingredients: [
        {'name': '달걀', 'amount': 2, 'unit': 'count'},
        {'name': '토마토', 'amount': 200, 'unit': 'g'},
        {'name': '식용유', 'amount': 1, 'unit': 'tbsp'},
      ],
      synthetic: true,
    );
  }

  Future<void> _createReviewedRecipe() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) =>
          _ReviewedRecipeDialog(importOptions: widget.importOptions),
    );
    if (draft == null || !mounted) return;
    await _submitRecipe(
      title: _text(draft['title']),
      baseServings: draft['baseServings'] as int,
      targetServings: draft['targetServings'] as int,
      ingredients: _objects(draft['ingredients']),
      importId: _text(draft['importId']),
    );
  }

  Future<void> _submitRecipe({
    required String title,
    required int baseServings,
    required int targetServings,
    required List<KernelJson> ingredients,
    String? importId,
    bool synthetic = false,
  }) async {
    if (_intentLoading ||
        _intentError != null ||
        _pendingRecipeIntent != null) {
      return;
    }
    setState(() => _creatingRecipe = true);
    try {
      final suffix = newKernelCommandId();
      final activityId = 'activity-$suffix';
      final recipeId =
          '${importId == null ? 'sample' : 'reviewed'}-recipe-$suffix';
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': activityId,
        'confirmed': true,
        'recipe': {
          'id': recipeId,
          'revision': 1,
          'title': title,
          'baseServings': baseServings,
          'ingredients': [
            for (var index = 0; index < ingredients.length; index++)
              {
                'id': '$recipeId-line-${index + 1}',
                'ingredientId': '$recipeId-ingredient-${index + 1}',
                'name': ingredients[index]['name'],
                'quantity': {
                  'status': 'known',
                  'amount': ingredients[index]['amount'],
                  'unit': ingredients[index]['unit'],
                },
                'scaling': 'linear',
                'optional': false,
              },
          ],
        },
        'targetServings': targetServings,
        'inventory': <Object?>[],
      };
      if (importId != null) request['importId'] = importId;
      if (synthetic) request['synthetic'] = true;
      await _intentStore.save(request);
      if (mounted) setState(() => _pendingRecipeIntent = request);
      await _sendRecipeIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingRecipe = false);
    }
  }

  Future<void> _retryRecipeIntent() async {
    final pending = _pendingRecipeIntent;
    if (pending == null || _creatingRecipe) return;
    setState(() => _creatingRecipe = true);
    try {
      await _sendRecipeIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingRecipe = false);
    }
  }

  Future<void> _sendRecipeIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createRecipeScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'INVALID_RECIPE_PLAN',
        'IMPORT_NOT_FOUND',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _intentStore.clear();
        if (mounted) setState(() => _pendingRecipeIntent = null);
      }
      rethrow;
    }
    final createdId = result['activityId'];
    if (createdId is! String || createdId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 레시피 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _intentStore.clear();
    if (mounted) {
      setState(() => _pendingRecipeIntent = null);
      await _open(createdId);
    }
  }

  Future<void> _discardRecipeIntent({bool corrupt = false}) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 레시피 생성 요청 지우기'),
        content: Text(
          corrupt
              ? '저장된 요청을 읽을 수 없어요. 지우면 요청 ID로 중복 생성을 확인할 수 없게 됩니다.'
              : '서버에 활동이 이미 만들어졌을 수 있어요. 요청을 지우고 다시 만들면 중복 활동이 생길 수 있습니다. 먼저 목록을 확인해 주세요.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('요청 지우기'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _intentStore.clear();
      if (mounted) {
        setState(() {
          _pendingRecipeIntent = null;
          _intentError = null;
        });
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
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
      onPressed: _creating || _creatingRecipe || _loading ? null : _create,
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
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '첫 레시피 시나리오',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          '샘플 재료와 수량으로 계획을 제안받고, 확인 후 승인할 수 있어요. 재고는 아직 모르는 상태로 시작해요.',
                        ),
                        const SizedBox(height: 8),
                        FilledButton.icon(
                          key: const Key('kernel-create-sample-recipe'),
                          onPressed:
                              _creating ||
                                  _creatingRecipe ||
                                  _intentLoading ||
                                  _intentError != null ||
                                  _pendingRecipeIntent != null
                              ? null
                              : _createSampleRecipe,
                          icon: const Icon(Icons.restaurant_menu),
                          label: Text(_creatingRecipe ? '만드는 중' : '샘플 레시피로 시작'),
                        ),
                      ],
                    ),
                  ),
                ),
                if (widget.importOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '확인한 자료로 레시피 만들기',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const Text(
                            '동기화한 자료를 근거로 연결하고 레시피·수량·인분은 직접 확인해 입력해요.',
                          ),
                          FilledButton(
                            key: const Key('kernel-create-reviewed-recipe'),
                            onPressed:
                                _creating ||
                                    _creatingRecipe ||
                                    _intentLoading ||
                                    _intentError != null ||
                                    _pendingRecipeIntent != null
                                ? null
                                : _createReviewedRecipe,
                            child: const Text('자료 선택하고 레시피 입력'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingRecipeIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 레시피 생성 요청이 있어요.'),
                          const Text(
                            '같은 요청 ID로 다시 보내면 서버가 이미 만든 활동을 중복 생성하지 않아요.',
                          ),
                          FilledButton(
                            key: const Key('kernel-retry-recipe-create'),
                            onPressed: _creatingRecipe
                                ? null
                                : _retryRecipeIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-recipe-create'),
                            onPressed: _creatingRecipe
                                ? null
                                : _discardRecipeIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_intentError != null)
                  Card(
                    child: Column(
                      children: [
                        _ErrorPanel(
                          message: '저장된 레시피 생성 요청을 읽지 못했어요. 다시 불러와 주세요.',
                          onRefresh: _loadRecipeIntent,
                        ),
                        if (_intentError is FormatException)
                          TextButton(
                            key: const Key(
                              'kernel-discard-corrupt-recipe-intent',
                            ),
                            onPressed: () =>
                                _discardRecipeIntent(corrupt: true),
                            child: const Text('손상된 요청 지우기'),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
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

  Future<void> _acceptProposal(KernelJson proposal) =>
      _mutate((_, commandId) async {
        await widget.client.acceptProposal(
          proposalId: _text(proposal['id']),
          commandId: commandId,
        );
      });

  Future<void> _resolveReview(KernelJson task) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 결과 유지'),
        content: const Text('연결된 정보가 바뀌었어요. 현재 작업의 이전 결과를 계속 사용하시겠어요?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('이전 결과 유지'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _command('task.resolveReview', {
      'taskId': task['id'],
      'expectedTaskRevision': task['revision'],
      'resolution': 'keep_consumed',
    });
  }

  KernelJson _capability(KernelJson task) =>
      _objects(
        widget.contracts['capabilities'],
      ).where((cap) => cap['id'] == task['capabilityId']).firstOrNull ??
      {};

  Map<String, KernelJson> _recipeIngredients() {
    final ingredients = <String, KernelJson>{};
    for (final task in _objects(_board?['tasks'])) {
      final recipe = _object(_object(_taskInputs(task))['recipe']);
      for (final ingredient in _objects(recipe['ingredients'])) {
        final id = ingredient['ingredientId'];
        if (id is String) ingredients[id] = ingredient;
      }
    }
    return ingredients;
  }

  Future<void> _complete(KernelJson task) async {
    final cap = _capability(task);
    Object? output;
    if (task['outputSchema'] != null || cap['outputType'] != null) {
      final capabilityId = _text(task['capabilityId']);
      final response = await showDialog<KernelJson>(
        context: context,
        builder: (_) => switch (capabilityId) {
          'recipe.check_inventory' => _InventoryResultDialog(
            ingredientIds: _strings(
              _object(_taskInputs(task))['ingredientIds'],
            ),
            ingredients: _recipeIngredients(),
          ),
          'recipe.cook' => _CookResultDialog(
            recipeId: _text(_object(_taskInputs(task))['recipeId']),
            targetServings: _object(_taskInputs(task))['targetServings'],
          ),
          _ => _TaskResultDialog(
            outputType: _text(cap['outputType'], '결과 JSON'),
          ),
        },
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
    final isRecipe = _text(task['capabilityId']).startsWith('recipe.');
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
            if (isRecipe)
              _RecipeInputs(
                capabilityId: _text(task['capabilityId']),
                value: _taskInputs(task),
                ingredients: _recipeIngredients(),
              )
            else
              _JsonDetails(title: '입력과 연결 정보', value: _taskInputs(task)),
            if (task['latestOutputRef'] != null)
              if (isRecipe)
                _RecipeResult(
                  capabilityId: _text(task['capabilityId']),
                  value: _objects(_board?['results'])
                      .where(
                        (result) => result['id'] == task['latestOutputRef'],
                      )
                      .firstOrNull?['value'],
                )
              else
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
                    onPressed: enabled ? () => _resolveReview(task) : null,
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

  Widget _proposalCard(KernelJson proposal, bool hasPendingChanges) {
    final plan = _object(proposal['plan']);
    final tasks = _objects(plan['tasks']);
    final recipeTasks = tasks.where(
      (task) => _text(task['capabilityId']).startsWith('recipe.'),
    );
    final targetServings = recipeTasks
        .map((task) => _object(task['inputBindings'])['targetServings'])
        .firstWhere((value) => value is num, orElse: () => null);
    final recipe = recipeTasks
        .map((task) => _object(_object(task['inputBindings'])['recipe']))
        .firstWhere((value) => value.isNotEmpty, orElse: () => {});
    final canApprove =
        !_busy &&
        !_needsRefresh &&
        !hasPendingChanges &&
        _board?['lifecycle'] == 'active' &&
        proposal['id'] is String;
    return Card(
      key: ValueKey('kernel-proposal-${proposal['id']}'),
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              recipeTasks.isNotEmpty ? '레시피 계획 제안' : '계획 제안',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(
              targetServings is num
                  ? '$targetServings인분 · 작업 ${tasks.length}개'
                  : '작업 ${tasks.length}개',
            ),
            if (recipe.isNotEmpty) ...[
              Text(
                '레시피: ${_text(recipe['title'], '이름 없음')} · 기준 ${recipe['baseServings']}인분',
              ),
              for (final ingredient in _objects(recipe['ingredients']))
                Text(
                  '재료 · ${_text(ingredient['name'])} ${_quantity(ingredient['quantity'])}',
                ),
            ],
            for (final task in tasks)
              Text(
                '• ${_text(task['title'], _text(task['capabilityId'], '작업'))}',
              ),
            const SizedBox(height: 8),
            const Text('계획은 확인 후 승인해야 작업 보드에 적용돼요.'),
            if (hasPendingChanges)
              const Text('연결된 정보가 변경됐어요. 새 계획을 만든 뒤 승인해 주세요.'),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                key: ValueKey('kernel-approve-proposal-${proposal['id']}'),
                onPressed: canApprove ? () => _acceptProposal(proposal) : null,
                child: const Text('계획 승인'),
              ),
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
    final proposals = _objects(board['pendingProposals']);
    final recipeBoard = _isRecipeBoard(board);
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
        for (final proposal in proposals)
          _proposalCard(proposal, pendingChanges.isNotEmpty),
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
                  if (recipeBoard)
                    const Text('레시피 근거나 재고가 바뀌었어요. 계획을 다시 확인해 주세요.'),
                  if (!recipeBoard)
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
    child:
        artifact['rendererKey'] == 'recipe.ingredients' ||
            artifact['rendererKey'] == 'recipe.shopping_list'
        ? Padding(
            padding: const EdgeInsets.all(16),
            child: _RecipeResult(
              capabilityId: artifact['rendererKey'] == 'recipe.ingredients'
                  ? 'recipe.scale_servings'
                  : 'recipe.calculate_requirements',
              value: artifact['data'],
            ),
          )
        : _JsonDetails(
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

final class _RecipeInputs extends StatelessWidget {
  const _RecipeInputs({
    required this.capabilityId,
    required this.value,
    required this.ingredients,
  });
  final String capabilityId;
  final Object? value;
  final Map<String, KernelJson> ingredients;

  @override
  Widget build(BuildContext context) {
    final input = _object(value);
    final recipe = _object(input['recipe']);
    final recipeIngredients = _objects(recipe['ingredients']);
    final ingredientIds = _strings(input['ingredientIds']);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('레시피 입력', style: Theme.of(context).textTheme.labelLarge),
          if (recipe.isNotEmpty) ...[
            Text(_text(recipe['title'], '레시피')),
            Text(
              '기준 ${recipe['baseServings']}인분 → 목표 ${input['targetServings']}인분',
            ),
            for (final ingredient in recipeIngredients)
              Text(
                '• ${_text(ingredient['name'], '재료')} ${_quantity(ingredient['quantity'])}',
              ),
          ] else if (capabilityId == 'recipe.check_inventory') ...[
            const Text('보유 수량을 확인할 재료'),
            for (final id in ingredientIds)
              Text('• ${_text(ingredients[id]?['name'], id)}'),
          ] else if (capabilityId == 'recipe.cook') ...[
            Text('요리할 분량: ${input['targetServings']}인분'),
            const Text('완료 기록은 실제 요리 여부만 남기며 재고를 자동으로 차감하지 않아요.'),
          ] else if (input.isEmpty)
            const Text('앞선 작업 결과를 기다리고 있어요.'),
        ],
      ),
    );
  }
}

final class _RecipeResult extends StatelessWidget {
  const _RecipeResult({required this.capabilityId, required this.value});
  final String capabilityId;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    final result = _object(value);
    final title = switch (capabilityId) {
      'recipe.scale_servings' => '인분별 재료',
      'recipe.calculate_requirements' => '필요한 재료',
      'recipe.check_inventory' => '확인한 재고',
      'recipe.cook' => '요리 완료 기록',
      _ => '레시피 결과',
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.labelLarge),
          if (capabilityId == 'recipe.scale_servings')
            for (final ingredient in _objects(result['ingredients']))
              Text(
                '• ${_text(ingredient['name'], '재료')} ${_quantity(ingredient['quantity'])}',
              ),
          if (capabilityId == 'recipe.calculate_requirements')
            for (final item in _objects(result['items']))
              Text(
                '• ${_text(item['name'], '재료')}: ${_requirementStatus(item['status'])} '
                '(필요 ${_quantity(item['requiredQuantity'])}, '
                '재고 ${_quantity(item['availableQuantity'])}, '
                '부족 ${_quantity(item['missingQuantity'])})',
              ),
          if (capabilityId == 'recipe.check_inventory')
            for (final item in _objects(value))
              Text(
                '• ${_text(item['ingredientId'], '재료')}: ${_quantity(item['quantity'])}',
              ),
          if (capabilityId == 'recipe.cook' && result.isNotEmpty)
            Text('완료 시각: ${_text(result['completedAt'])}'),
          if (value == null) const Text('결과를 불러오지 못했어요. 새로고침해 주세요.'),
        ],
      ),
    );
  }
}

final class _SampleRecipeDialog extends StatefulWidget {
  const _SampleRecipeDialog();

  @override
  State<_SampleRecipeDialog> createState() => _SampleRecipeDialogState();
}

final class _SampleRecipeDialogState extends State<_SampleRecipeDialog> {
  final _servings = TextEditingController(text: '4');
  final _form = GlobalKey<FormState>();
  bool _confirmed = false;

  @override
  void dispose() {
    _servings.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('샘플 레시피 확인'),
    content: SizedBox(
      width: 440,
      child: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '이 데이터는 첫 흐름을 시험하기 위해 만든 예시예요. 실제 캡처나 확인된 보유 재료가 아니에요.',
              ),
              const SizedBox(height: 12),
              const Text('토마토 달걀 볶음 · 기준 2인분'),
              const Text('• 달걀 2개'),
              const Text('• 토마토 200 g'),
              const Text('• 식용유 1 tbsp'),
              const Text('재고: 아직 확인하지 않음'),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('kernel-sample-servings'),
                controller: _servings,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '목표 인분'),
                validator: (value) {
                  final parsed = int.tryParse(value?.trim() ?? '');
                  return parsed == null || parsed < 1 || parsed > 20
                      ? '1~20인분을 입력해 주세요.'
                      : null;
                },
              ),
              CheckboxListTile(
                key: const Key('kernel-sample-recipe-acknowledge'),
                contentPadding: EdgeInsets.zero,
                value: _confirmed,
                onChanged: (value) =>
                    setState(() => _confirmed = value == true),
                title: const Text('위 재료와 수량을 확인했고 샘플 데이터로 사용하겠습니다'),
              ),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        key: const Key('kernel-confirm-sample-recipe'),
        onPressed: _confirmed
            ? () {
                if (_form.currentState!.validate()) {
                  Navigator.pop(context, int.parse(_servings.text.trim()));
                }
              }
            : null,
        child: const Text('샘플 활동 만들기'),
      ),
    ],
  );
}

final class _ReviewedRecipeDialog extends StatefulWidget {
  const _ReviewedRecipeDialog({required this.importOptions});

  final List<RecipeImportOption> importOptions;

  @override
  State<_ReviewedRecipeDialog> createState() => _ReviewedRecipeDialogState();
}

final class _IngredientEditor {
  final name = TextEditingController();
  final amount = TextEditingController();
  String unit = 'g';

  void dispose() {
    name.dispose();
    amount.dispose();
  }
}

final class _ReviewedRecipeDialogState extends State<_ReviewedRecipeDialog> {
  static const _units = ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp'];
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _baseServings = TextEditingController(text: '2');
  final _targetServings = TextEditingController(text: '2');
  final _ingredients = <_IngredientEditor>[_IngredientEditor()];
  late String _selectedImportId = widget.importOptions.first.importId;
  bool _reviewing = false;
  bool _confirmed = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _baseServings.dispose();
    _targetServings.dispose();
    for (final ingredient in _ingredients) {
      ingredient.dispose();
    }
    super.dispose();
  }

  String? _servingsError(String? value) {
    final parsed = int.tryParse(value?.trim() ?? '');
    return parsed == null || parsed < 1 || parsed > 50
        ? '1~50인분을 입력해 주세요.'
        : null;
  }

  void _review() {
    if (!_form.currentState!.validate()) return;
    final names = _ingredients
        .map((line) => line.name.text.trim().toLowerCase())
        .toList();
    if (names.toSet().length != names.length) {
      setState(() => _error = '같은 재료는 한 번만 입력해 주세요.');
      return;
    }
    setState(() {
      _error = null;
      _reviewing = true;
      _confirmed = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.importOptions.firstWhere(
      (item) => item.importId == _selectedImportId,
    );
    return AlertDialog(
      title: Text(_reviewing ? '레시피 내용 확인' : '확인한 자료로 레시피 만들기'),
      content: SizedBox(
        width: 540,
        child: SingleChildScrollView(
          child: _reviewing
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('연결할 자료: ${selected.title}'),
                    Text('레시피: ${_title.text.trim()}'),
                    Text(
                      '기준 ${_baseServings.text.trim()}인분 → 목표 ${_targetServings.text.trim()}인분',
                    ),
                    for (final ingredient in _ingredients)
                      Text(
                        '• ${ingredient.name.text.trim()} ${ingredient.amount.text.trim()} ${ingredient.unit}',
                      ),
                    const SizedBox(height: 12),
                    const Text(
                      '위 수량과 인분은 자료에서 자동 추출한 값이 아니라 내가 직접 입력하고 확인한 값이에요. 재고는 이후 작업에서 확인해요.',
                    ),
                    CheckboxListTile(
                      key: const Key('kernel-reviewed-recipe-confirm'),
                      contentPadding: EdgeInsets.zero,
                      value: _confirmed,
                      onChanged: (value) =>
                          setState(() => _confirmed = value == true),
                      title: const Text('레시피 내용과 자료 연결을 확인했어요'),
                    ),
                  ],
                )
              : Form(
                  key: _form,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('동기화한 자료는 근거로만 연결됩니다. 레시피 내용은 직접 입력해 주세요.'),
                      DropdownButton<String>(
                        key: const Key('kernel-reviewed-import-select'),
                        value: _selectedImportId,
                        isExpanded: true,
                        items: [
                          for (final option in widget.importOptions)
                            DropdownMenuItem(
                              value: option.importId,
                              child: Text(option.title),
                            ),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setState(() => _selectedImportId = value);
                          }
                        },
                      ),
                      TextFormField(
                        key: const Key('kernel-reviewed-recipe-title'),
                        controller: _title,
                        maxLength: 200,
                        decoration: const InputDecoration(labelText: '레시피 이름'),
                        validator: (value) {
                          final title = value?.trim() ?? '';
                          if (title.isEmpty) return '레시피 이름을 입력해 주세요.';
                          if (title.length > 200) return '200자 이하로 입력해 주세요.';
                          return null;
                        },
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              key: const Key('kernel-reviewed-base-servings'),
                              controller: _baseServings,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: '기준 인분',
                              ),
                              validator: _servingsError,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextFormField(
                              key: const Key('kernel-reviewed-target-servings'),
                              controller: _targetServings,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: '목표 인분',
                              ),
                              validator: _servingsError,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      const Text('재료와 기준 수량'),
                      for (var index = 0; index < _ingredients.length; index++)
                        Row(
                          children: [
                            Expanded(
                              flex: 2,
                              child: TextFormField(
                                key: ValueKey(
                                  'kernel-reviewed-ingredient-name-$index',
                                ),
                                controller: _ingredients[index].name,
                                maxLength: 100,
                                decoration: const InputDecoration(
                                  labelText: '재료',
                                ),
                                validator: (value) {
                                  final name = value?.trim() ?? '';
                                  if (name.isEmpty) return '재료를 입력해 주세요.';
                                  if (name.length > 100) {
                                    return '100자 이하로 입력해 주세요.';
                                  }
                                  return null;
                                },
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: TextFormField(
                                key: ValueKey(
                                  'kernel-reviewed-ingredient-amount-$index',
                                ),
                                controller: _ingredients[index].amount,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: '수량',
                                ),
                                validator: (value) {
                                  final amount = num.tryParse(
                                    value?.trim() ?? '',
                                  );
                                  return amount == null ||
                                          !amount.isFinite ||
                                          amount <= 0 ||
                                          amount > 1000000000
                                      ? '0 초과 10억 이하로 입력해 주세요.'
                                      : null;
                                },
                              ),
                            ),
                            const SizedBox(width: 6),
                            DropdownButton<String>(
                              value: _ingredients[index].unit,
                              items: [
                                for (final unit in _units)
                                  DropdownMenuItem(
                                    value: unit,
                                    child: Text(unit),
                                  ),
                              ],
                              onChanged: (unit) {
                                if (unit != null) {
                                  setState(
                                    () => _ingredients[index].unit = unit,
                                  );
                                }
                              },
                            ),
                          ],
                        ),
                      TextButton.icon(
                        key: const Key('kernel-reviewed-add-ingredient'),
                        onPressed: _ingredients.length >= 25
                            ? null
                            : () => setState(
                                () => _ingredients.add(_IngredientEditor()),
                              ),
                        icon: const Icon(Icons.add),
                        label: const Text('재료 추가'),
                      ),
                      if (_error != null)
                        Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                    ],
                  ),
                ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () {
            if (_reviewing) {
              setState(() => _reviewing = false);
            } else {
              Navigator.pop(context);
            }
          },
          child: Text(_reviewing ? '수정' : '취소'),
        ),
        FilledButton(
          key: Key(
            _reviewing ? 'kernel-reviewed-submit' : 'kernel-reviewed-preview',
          ),
          onPressed: _reviewing
              ? _confirmed
                    ? () => Navigator.pop(context, <String, Object?>{
                        'importId': _selectedImportId,
                        'title': _title.text.trim(),
                        'baseServings': int.parse(_baseServings.text.trim()),
                        'targetServings': int.parse(
                          _targetServings.text.trim(),
                        ),
                        'ingredients': [
                          for (final ingredient in _ingredients)
                            {
                              'name': ingredient.name.text.trim(),
                              'amount': num.parse(
                                ingredient.amount.text.trim(),
                              ),
                              'unit': ingredient.unit,
                            },
                        ],
                      })
                    : null
              : _review,
          child: Text(_reviewing ? '확인하고 계획 제안' : '내용 검토'),
        ),
      ],
    );
  }
}

final class _CookResultDialog extends StatefulWidget {
  const _CookResultDialog({
    required this.recipeId,
    required this.targetServings,
  });
  final String recipeId;
  final Object? targetServings;

  @override
  State<_CookResultDialog> createState() => _CookResultDialogState();
}

final class _CookResultDialogState extends State<_CookResultDialog> {
  final _reporter = TextEditingController();
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _reporter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('요리 완료 기록'),
    content: Form(
      key: _form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            widget.recipeId.isEmpty
                ? '레시피 연결 정보를 확인할 수 없어요. 새로고침해 주세요.'
                : '${widget.targetServings}인분 요리를 실제로 마쳤나요? 완료를 기록해도 재고는 자동으로 차감되지 않아요.',
          ),
          TextFormField(
            key: const Key('kernel-cook-reporter'),
            controller: _reporter,
            decoration: const InputDecoration(labelText: '완료한 사람'),
            validator: (value) => value == null || value.trim().isEmpty
                ? '완료한 사람을 입력해 주세요.'
                : null,
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
        key: const Key('kernel-confirm-cook'),
        onPressed: widget.recipeId.isEmpty
            ? null
            : () {
                if (!_form.currentState!.validate()) return;
                Navigator.pop(context, <String, Object?>{
                  'output': {
                    'recipeId': widget.recipeId,
                    'completedAt': DateTime.now().toUtc().toIso8601String(),
                    'reportedBy': _reporter.text.trim(),
                  },
                });
              },
        child: const Text('완료 기록'),
      ),
    ],
  );
}

final class _InventoryResultDialog extends StatefulWidget {
  const _InventoryResultDialog({
    required this.ingredientIds,
    required this.ingredients,
  });
  final List<String> ingredientIds;
  final Map<String, KernelJson> ingredients;

  @override
  State<_InventoryResultDialog> createState() => _InventoryResultDialogState();
}

final class _InventoryResultDialogState extends State<_InventoryResultDialog> {
  static const _units = ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp'];
  final _form = GlobalKey<FormState>();
  late final List<TextEditingController> _amounts = [
    for (final _ in widget.ingredientIds) TextEditingController(),
  ];
  late final List<String> _selectedUnits = [
    for (final id in widget.ingredientIds)
      _text(_object(widget.ingredients[id]?['quantity'])['unit'], 'g'),
  ];

  @override
  void dispose() {
    for (final controller in _amounts) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('재고 확인'),
    content: SizedBox(
      width: 480,
      child: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('알고 있는 수량만 입력하세요. 빈칸은 모르는 재고로 기록돼요.'),
              for (var index = 0; index < widget.ingredientIds.length; index++)
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        key: ValueKey('kernel-inventory-amount-$index'),
                        controller: _amounts[index],
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: _text(
                            widget.ingredients[widget
                                .ingredientIds[index]]?['name'],
                            widget.ingredientIds[index],
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return null;
                          }
                          final amount = num.tryParse(value.trim());
                          return amount == null ||
                                  !amount.isFinite ||
                                  amount < 0
                              ? '0 이상의 수량을 입력해 주세요.'
                              : null;
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    DropdownButton<String>(
                      value: _selectedUnits[index],
                      items: [
                        for (final unit in _units)
                          DropdownMenuItem(value: unit, child: Text(unit)),
                      ],
                      onChanged: (unit) {
                        if (unit != null) {
                          setState(() => _selectedUnits[index] = unit);
                        }
                      },
                    ),
                  ],
                ),
              if (widget.ingredientIds.isEmpty)
                const Text('확인할 재료가 없어요. 활동을 새로고침해 주세요.'),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        key: const Key('kernel-confirm-inventory'),
        onPressed: widget.ingredientIds.isEmpty
            ? null
            : () {
                if (!_form.currentState!.validate()) return;
                final observedAt = DateTime.now().toUtc().toIso8601String();
                Navigator.pop(context, <String, Object?>{
                  'output': [
                    for (
                      var index = 0;
                      index < widget.ingredientIds.length;
                      index++
                    )
                      {
                        'ingredientId': widget.ingredientIds[index],
                        'quantity': _amounts[index].text.trim().isEmpty
                            ? {'status': 'unknown'}
                            : {
                                'status': 'known',
                                'amount': num.parse(
                                  _amounts[index].text.trim(),
                                ),
                                'unit': _selectedUnits[index],
                              },
                        'observedAt': observedAt,
                      },
                  ],
                });
              },
        child: const Text('재고 기록'),
      ),
    ],
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
