import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/common_kernel_client.dart';
import '../../data/place_map_links.dart';
import 'travel_scenario_dialogs.dart';
import 'life_tip_scenario_dialogs.dart';

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
    this.diningIntentStore,
    this.fashionIntentStore,
    this.beautyIntentStore,
    this.travelIntentStore,
    this.lifeTipIntentStore,
    this.importOptions = const [],
    this.diningImportOptions = const [],
    this.fashionImportOptions = const [],
    this.beautyImportOptions = const [],
    this.travelImportOptions = const [],
    this.lifeTipImportOptions = const [],
    this.onOpenDiningImport,
    this.onOpenFashionImport,
    this.onOpenBeautyImport,
    this.onOpenTravelImport,
    this.onOpenLifeTipImport,
    super.key,
  });
  final CommonKernelClient? client;
  final RecipeScenarioIntentStore? intentStore;
  final DiningScenarioIntentStore? diningIntentStore;
  final FashionScenarioIntentStore? fashionIntentStore;
  final BeautyScenarioIntentStore? beautyIntentStore;
  final TravelScenarioIntentStore? travelIntentStore;
  final LifeTipScenarioIntentStore? lifeTipIntentStore;
  final List<RecipeImportOption> importOptions;
  final List<DiningImportOption> diningImportOptions;
  final List<FashionImportOption> fashionImportOptions;
  final List<BeautyImportOption> beautyImportOptions;
  final List<TravelImportOption> travelImportOptions;
  final List<LifeTipImportOption> lifeTipImportOptions;
  final void Function(String importId)? onOpenDiningImport;
  final void Function(String importId)? onOpenFashionImport;
  final void Function(String importId)? onOpenBeautyImport;
  final void Function(String importId)? onOpenTravelImport;
  final void Function(String importId)? onOpenLifeTipImport;

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

final class DiningImportOption {
  const DiningImportOption({
    required this.importId,
    required this.title,
    required this.placeName,
    required this.searchArea,
  });

  final String importId;
  final String title;
  final String placeName;
  final String searchArea;
}

final class FashionImportOption {
  const FashionImportOption({required this.importId, required this.title});

  final String importId;
  final String title;
}

final class BeautyImportOption {
  const BeautyImportOption({required this.importId, required this.title});

  final String importId;
  final String title;
}

final class _CommonBoardsScreenState extends State<CommonBoardsScreen> {
  late final CommonKernelClient _client =
      widget.client ?? const HttpCommonKernelClient();
  late final RecipeScenarioIntentStore _intentStore =
      widget.intentStore ?? const FileRecipeScenarioIntentStore();
  late final DiningScenarioIntentStore _diningIntentStore =
      widget.diningIntentStore ?? const FileDiningScenarioIntentStore();
  late final FashionScenarioIntentStore _fashionIntentStore =
      widget.fashionIntentStore ?? const FileFashionScenarioIntentStore();
  late final BeautyScenarioIntentStore _beautyIntentStore =
      widget.beautyIntentStore ?? const FileBeautyScenarioIntentStore();
  late final TravelScenarioIntentStore _travelIntentStore =
      widget.travelIntentStore ?? const FileTravelScenarioIntentStore();
  late final LifeTipScenarioIntentStore _lifeTipIntentStore =
      widget.lifeTipIntentStore ?? const FileLifeTipScenarioIntentStore();
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
  bool _creatingDining = false;
  bool _creatingFashion = false;
  bool _creatingBeauty = false;
  bool _creatingTravel = false;
  bool _creatingLifeTip = false;
  bool _intentLoading = true;
  bool _diningIntentLoading = true;
  bool _fashionIntentLoading = true;
  bool _beautyIntentLoading = true;
  bool _travelIntentLoading = true;
  bool _lifeTipIntentLoading = true;
  KernelJson? _pendingRecipeIntent;
  KernelJson? _pendingDiningIntent;
  KernelJson? _pendingFashionIntent;
  KernelJson? _pendingBeautyIntent;
  KernelJson? _pendingTravelIntent;
  KernelJson? _pendingLifeTipIntent;
  Object? _intentError;
  Object? _diningIntentError;
  Object? _fashionIntentError;
  Object? _beautyIntentError;
  Object? _travelIntentError;
  Object? _lifeTipIntentError;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _load();
    unawaited(_loadRecipeIntent());
    unawaited(_loadDiningIntent());
    unawaited(_loadFashionIntent());
    unawaited(_loadBeautyIntent());
    unawaited(_loadTravelIntent());
    unawaited(_loadLifeTipIntent());
  }

  Future<void> _loadLifeTipIntent() async {
    setState(() {
      _lifeTipIntentLoading = true;
      _lifeTipIntentError = null;
    });
    try {
      final pending = await _lifeTipIntentStore.load();
      if (mounted) setState(() => _pendingLifeTipIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _lifeTipIntentError = error);
    } finally {
      if (mounted) setState(() => _lifeTipIntentLoading = false);
    }
  }

  Future<void> _loadTravelIntent() async {
    setState(() {
      _travelIntentLoading = true;
      _travelIntentError = null;
    });
    try {
      final pending = await _travelIntentStore.load();
      if (mounted) setState(() => _pendingTravelIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _travelIntentError = error);
    } finally {
      if (mounted) setState(() => _travelIntentLoading = false);
    }
  }

  Future<void> _loadBeautyIntent() async {
    setState(() {
      _beautyIntentLoading = true;
      _beautyIntentError = null;
    });
    try {
      final pending = await _beautyIntentStore.load();
      if (mounted) setState(() => _pendingBeautyIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _beautyIntentError = error);
    } finally {
      if (mounted) setState(() => _beautyIntentLoading = false);
    }
  }

  Future<void> _loadDiningIntent() async {
    setState(() {
      _diningIntentLoading = true;
      _diningIntentError = null;
    });
    try {
      final pending = await _diningIntentStore.load();
      if (mounted) setState(() => _pendingDiningIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _diningIntentError = error);
    } finally {
      if (mounted) setState(() => _diningIntentLoading = false);
    }
  }

  Future<void> _loadFashionIntent() async {
    setState(() {
      _fashionIntentLoading = true;
      _fashionIntentError = null;
    });
    try {
      final pending = await _fashionIntentStore.load();
      if (mounted) setState(() => _pendingFashionIntent = pending);
    } catch (error) {
      if (mounted) setState(() => _fashionIntentError = error);
    } finally {
      if (mounted) setState(() => _fashionIntentLoading = false);
    }
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
          onOpenDiningImport: widget.onOpenDiningImport,
          onOpenFashionImport: widget.onOpenFashionImport,
          onOpenBeautyImport: widget.onOpenBeautyImport,
          onOpenTravelImport: widget.onOpenTravelImport,
          onOpenLifeTipImport: widget.onOpenLifeTipImport,
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

  Future<void> _createReviewedDining() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) =>
          _DiningScenarioDialog(options: widget.diningImportOptions),
    );
    if (draft == null ||
        !mounted ||
        _pendingDiningIntent != null ||
        _diningIntentLoading ||
        _diningIntentError != null) {
      return;
    }
    setState(() => _creatingDining = true);
    try {
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': 'dining-${newKernelCommandId()}',
        'confirmed': true,
        ...draft,
      };
      await _diningIntentStore.save(request);
      if (mounted) setState(() => _pendingDiningIntent = request);
      await _sendDiningIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingDining = false);
    }
  }

  Future<void> _retryDiningIntent() async {
    final pending = _pendingDiningIntent;
    if (pending == null || _creatingDining) return;
    setState(() => _creatingDining = true);
    try {
      await _sendDiningIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingDining = false);
    }
  }

  Future<void> _sendDiningIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createDiningScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'IMPORT_NOT_FOUND',
        'IMPORT_NOT_DINING',
        'NO_DINING_CANDIDATES',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _diningIntentStore.clear();
        if (mounted) setState(() => _pendingDiningIntent = null);
      }
      rethrow;
    }
    final activityId = result['activityId'];
    if (activityId is! String || activityId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 맛집 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _diningIntentStore.clear();
    if (mounted) {
      setState(() => _pendingDiningIntent = null);
      await _open(activityId);
    }
  }

  Future<void> _discardDiningIntent() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 맛집 활동 요청 지우기'),
        content: const Text('서버에 활동이 이미 만들어졌을 수 있어요. 목록을 확인한 뒤 지워 주세요.'),
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
    if (confirmed != true || !mounted) {
      return;
    }
    try {
      await _diningIntentStore.clear();
      if (mounted) {
        setState(() {
          _pendingDiningIntent = null;
          _diningIntentError = null;
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

  Future<void> _createReviewedFashion() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) =>
          _FashionScenarioDialog(options: widget.fashionImportOptions),
    );
    if (draft == null ||
        !mounted ||
        _pendingFashionIntent != null ||
        _fashionIntentLoading ||
        _fashionIntentError != null) {
      return;
    }
    setState(() => _creatingFashion = true);
    try {
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': 'fashion-${newKernelCommandId()}',
        'confirmed': true,
        ...draft,
      };
      await _fashionIntentStore.save(request);
      if (mounted) setState(() => _pendingFashionIntent = request);
      await _sendFashionIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingFashion = false);
    }
  }

  Future<void> _retryFashionIntent() async {
    final pending = _pendingFashionIntent;
    if (pending == null || _creatingFashion) return;
    setState(() => _creatingFashion = true);
    try {
      await _sendFashionIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingFashion = false);
    }
  }

  Future<void> _sendFashionIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createFashionScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'IMPORT_NOT_FOUND',
        'IMPORT_NOT_FASHION',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _fashionIntentStore.clear();
        if (mounted) setState(() => _pendingFashionIntent = null);
      }
      rethrow;
    }
    final activityId = result['activityId'];
    if (activityId is! String || activityId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 패션 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _fashionIntentStore.clear();
    if (mounted) {
      setState(() => _pendingFashionIntent = null);
      await _open(activityId);
    }
  }

  Future<void> _discardFashionIntent() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 패션 활동 요청 지우기'),
        content: const Text('서버에 활동이 이미 만들어졌을 수 있어요. 목록을 확인한 뒤 지워 주세요.'),
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
      await _fashionIntentStore.clear();
      if (mounted) {
        setState(() {
          _pendingFashionIntent = null;
          _fashionIntentError = null;
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

  Future<void> _createReviewedBeauty() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) =>
          _BeautyScenarioDialog(options: widget.beautyImportOptions),
    );
    if (draft == null ||
        !mounted ||
        _pendingBeautyIntent != null ||
        _beautyIntentLoading ||
        _beautyIntentError != null) {
      return;
    }
    setState(() => _creatingBeauty = true);
    try {
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': 'beauty-${newKernelCommandId()}',
        'confirmed': true,
        ...draft,
      };
      await _beautyIntentStore.save(request);
      if (mounted) setState(() => _pendingBeautyIntent = request);
      await _sendBeautyIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingBeauty = false);
    }
  }

  Future<void> _retryBeautyIntent() async {
    final pending = _pendingBeautyIntent;
    if (pending == null || _creatingBeauty) return;
    setState(() => _creatingBeauty = true);
    try {
      await _sendBeautyIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingBeauty = false);
    }
  }

  Future<void> _sendBeautyIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createBeautyScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'IMPORT_NOT_FOUND',
        'IMPORT_NOT_BEAUTY',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _beautyIntentStore.clear();
        if (mounted) setState(() => _pendingBeautyIntent = null);
      }
      rethrow;
    }
    final activityId = result['activityId'];
    if (activityId is! String || activityId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 뷰티 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _beautyIntentStore.clear();
    if (mounted) {
      setState(() => _pendingBeautyIntent = null);
      await _open(activityId);
    }
  }

  Future<void> _discardBeautyIntent() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 뷰티 활동 요청 지우기'),
        content: const Text('서버에 활동이 이미 만들어졌을 수 있어요. 목록을 확인한 뒤 지워 주세요.'),
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
      await _beautyIntentStore.clear();
      if (mounted) {
        setState(() {
          _pendingBeautyIntent = null;
          _beautyIntentError = null;
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

  Future<void> _createReviewedTravel() async {
    final draft = await showDialog<KernelJson>(
      context: context,
      builder: (_) => TravelScenarioDialog(options: widget.travelImportOptions),
    );
    if (draft == null ||
        !mounted ||
        _pendingTravelIntent != null ||
        _travelIntentLoading ||
        _travelIntentError != null) {
      return;
    }
    setState(() => _creatingTravel = true);
    try {
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': 'travel-${newKernelCommandId()}',
        'confirmed': true,
        ...draft,
      };
      await _travelIntentStore.save(request);
      if (mounted) setState(() => _pendingTravelIntent = request);
      await _sendTravelIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingTravel = false);
    }
  }

  Future<void> _retryTravelIntent() async {
    final pending = _pendingTravelIntent;
    if (pending == null || _creatingTravel) return;
    setState(() => _creatingTravel = true);
    try {
      await _sendTravelIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingTravel = false);
    }
  }

  Future<void> _sendTravelIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createTravelScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'IMPORT_NOT_FOUND',
        'IMPORT_NOT_TRAVEL',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _travelIntentStore.clear();
        if (mounted) setState(() => _pendingTravelIntent = null);
      }
      rethrow;
    }
    final activityId = result['activityId'];
    if (activityId is! String || activityId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 여행 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _travelIntentStore.clear();
    if (mounted) {
      setState(() => _pendingTravelIntent = null);
      await _open(activityId);
    }
  }

  Future<void> _discardTravelIntent() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 여행 활동 요청 지우기'),
        content: const Text('서버에 활동이 이미 만들어졌을 수 있어요. 목록을 확인한 뒤 지워 주세요.'),
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
      await _travelIntentStore.clear();
      if (mounted) {
        setState(() {
          _pendingTravelIntent = null;
          _travelIntentError = null;
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

  Future<void> _createReviewedLifeTip() async {
    final importId = await showDialog<String>(
      context: context,
      builder: (_) =>
          LifeTipScenarioDialog(options: widget.lifeTipImportOptions),
    );
    if (importId == null ||
        !mounted ||
        _pendingLifeTipIntent != null ||
        _lifeTipIntentLoading ||
        _lifeTipIntentError != null) {
      return;
    }
    setState(() => _creatingLifeTip = true);
    try {
      final request = <String, Object?>{
        'commandId': newKernelCommandId(),
        'activityId': 'life-tip-${newKernelCommandId()}',
        'confirmed': true,
        'importId': importId,
      };
      await _lifeTipIntentStore.save(request);
      if (mounted) setState(() => _pendingLifeTipIntent = request);
      await _sendLifeTipIntent(request);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingLifeTip = false);
    }
  }

  Future<void> _retryLifeTipIntent() async {
    final pending = _pendingLifeTipIntent;
    if (pending == null || _creatingLifeTip) return;
    setState(() => _creatingLifeTip = true);
    try {
      await _sendLifeTipIntent(pending);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_errorText(error))));
      }
    } finally {
      if (mounted) setState(() => _creatingLifeTip = false);
    }
  }

  Future<void> _sendLifeTipIntent(KernelJson request) async {
    KernelJson result;
    try {
      result = await _client.createLifeTipScenario(request);
    } on CommonKernelException catch (error) {
      if (const {
        'INVALID_REQUEST',
        'INVALID_DOMAIN_VALUE',
        'IMPORT_NOT_FOUND',
        'IMPORT_NOT_LIFE_TIP',
        'SCENARIO_DELETED',
      }.contains(error.code)) {
        await _lifeTipIntentStore.clear();
        if (mounted) setState(() => _pendingLifeTipIntent = null);
      }
      rethrow;
    }
    final activityId = result['activityId'];
    if (activityId is! String || activityId != request['activityId']) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '만든 꿀팁 활동의 ID를 확인할 수 없어요. 같은 요청으로 다시 확인해 주세요.',
      );
    }
    await _lifeTipIntentStore.clear();
    if (mounted) {
      setState(() => _pendingLifeTipIntent = null);
      await _open(activityId);
    }
  }

  Future<void> _discardLifeTipIntent() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('이전 생활 꿀팁 활동 요청 지우기'),
        content: const Text('서버에 활동이 이미 만들어졌을 수 있어요. 목록을 확인한 뒤 지워 주세요.'),
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
      await _lifeTipIntentStore.clear();
      if (mounted) {
        setState(() {
          _pendingLifeTipIntent = null;
          _lifeTipIntentError = null;
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
                if (widget.diningImportOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '첫 맛집 시나리오',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '확인한 식당 캡처에서 지역에 맞는 지점 후보를 모으고, 방문 결과까지 기록해요.',
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            key: const Key('kernel-create-dining'),
                            onPressed:
                                _creatingDining ||
                                    _diningIntentLoading ||
                                    _diningIntentError != null ||
                                    _pendingDiningIntent != null
                                ? null
                                : _createReviewedDining,
                            icon: const Icon(Icons.location_on_outlined),
                            label: Text(
                              _creatingDining ? '만드는 중' : '저장한 식당으로 시작',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingDiningIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 맛집 활동 요청이 있어요.'),
                          const Text('같은 요청 ID로 다시 보내면 중복 생성되지 않아요.'),
                          FilledButton(
                            key: const Key('kernel-retry-dining-create'),
                            onPressed: _creatingDining
                                ? null
                                : _retryDiningIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-dining-create'),
                            onPressed: _creatingDining
                                ? null
                                : _discardDiningIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_diningIntentError != null)
                  _ErrorPanel(
                    message: '저장된 맛집 활동 요청을 읽지 못했어요.',
                    onRefresh: _loadDiningIntent,
                  ),
                if (widget.fashionImportOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '첫 패션 시나리오',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '저장한 옷을 일정의 코디로 묶고, 옵션·소유와 실제 착용을 직접 확인해요.',
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            key: const Key('kernel-create-fashion'),
                            onPressed:
                                _creatingFashion ||
                                    _fashionIntentLoading ||
                                    _fashionIntentError != null ||
                                    _pendingFashionIntent != null
                                ? null
                                : _createReviewedFashion,
                            icon: const Icon(Icons.checkroom_outlined),
                            label: Text(
                              _creatingFashion ? '만드는 중' : '저장한 옷으로 시작',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingFashionIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 패션 활동 요청이 있어요.'),
                          const Text('같은 요청 ID로 재전송하면 중복 생성되지 않아요.'),
                          FilledButton(
                            key: const Key('kernel-retry-fashion-create'),
                            onPressed: _creatingFashion
                                ? null
                                : _retryFashionIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-fashion-create'),
                            onPressed: _creatingFashion
                                ? null
                                : _discardFashionIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_fashionIntentError != null)
                  _ErrorPanel(
                    message: '저장된 패션 활동 요청을 읽지 못했어요.',
                    onRefresh: _loadFashionIntent,
                  ),
                if (widget.beautyImportOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '첫 뷰티 시나리오',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '저장한 스킨케어 제품으로 루틴을 만들고, 순서·제품 옵션과 실제 사용을 직접 기록해요.',
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            key: const Key('kernel-create-beauty'),
                            onPressed:
                                _creatingBeauty ||
                                    _beautyIntentLoading ||
                                    _beautyIntentError != null ||
                                    _pendingBeautyIntent != null
                                ? null
                                : _createReviewedBeauty,
                            icon: const Icon(Icons.spa_outlined),
                            label: Text(
                              _creatingBeauty ? '만드는 중' : '저장한 제품으로 시작',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingBeautyIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 뷰티 활동 요청이 있어요.'),
                          const Text('같은 요청 ID로 재전송하면 중복 생성되지 않아요.'),
                          FilledButton(
                            key: const Key('kernel-retry-beauty-create'),
                            onPressed: _creatingBeauty
                                ? null
                                : _retryBeautyIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-beauty-create'),
                            onPressed: _creatingBeauty
                                ? null
                                : _discardBeautyIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_beautyIntentError != null)
                  _ErrorPanel(
                    message: '저장된 뷰티 활동 요청을 읽지 못했어요.',
                    onRefresh: _loadBeautyIntent,
                  ),
                if (widget.travelImportOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '첫 여행 시나리오',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '저장한 관광 장소로 하루 방문 순서와 시각을 정하고, 실제 방문한 곳만 기록해요.',
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            key: const Key('kernel-create-travel'),
                            onPressed:
                                _creatingTravel ||
                                    _travelIntentLoading ||
                                    _travelIntentError != null ||
                                    _pendingTravelIntent != null
                                ? null
                                : _createReviewedTravel,
                            icon: const Icon(Icons.route_outlined),
                            label: Text(
                              _creatingTravel ? '만드는 중' : '저장한 장소로 시작',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingTravelIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 여행 활동 요청이 있어요.'),
                          const Text('같은 요청 ID로 재전송하면 중복 생성되지 않아요.'),
                          FilledButton(
                            key: const Key('kernel-retry-travel-create'),
                            onPressed: _creatingTravel
                                ? null
                                : _retryTravelIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-travel-create'),
                            onPressed: _creatingTravel
                                ? null
                                : _discardTravelIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_travelIntentError != null)
                  _ErrorPanel(
                    message: '저장된 여행 활동 요청을 읽지 못했어요.',
                    onRefresh: _loadTravelIntent,
                  ),
                if (widget.lifeTipImportOptions.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '첫 생활 꿀팁 시나리오',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '저장한 단계형 꿀팁에서 실천할 항목을 고르고, 실제 한 단계만 기록해요.',
                          ),
                          const SizedBox(height: 8),
                          FilledButton.icon(
                            key: const Key('kernel-create-life-tip'),
                            onPressed:
                                _creatingLifeTip ||
                                    _lifeTipIntentLoading ||
                                    _lifeTipIntentError != null ||
                                    _pendingLifeTipIntent != null
                                ? null
                                : _createReviewedLifeTip,
                            icon: const Icon(Icons.lightbulb_outline),
                            label: Text(
                              _creatingLifeTip ? '만드는 중' : '저장한 꿀팁으로 시작',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_pendingLifeTipIntent != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('완료 여부를 확인할 꿀팁 활동 요청이 있어요.'),
                          const Text('같은 요청 ID로 재전송하면 중복 생성되지 않아요.'),
                          FilledButton(
                            key: const Key('kernel-retry-life-tip-create'),
                            onPressed: _creatingLifeTip
                                ? null
                                : _retryLifeTipIntent,
                            child: const Text('이전 생성 이어하기'),
                          ),
                          TextButton(
                            key: const Key('kernel-discard-life-tip-create'),
                            onPressed: _creatingLifeTip
                                ? null
                                : _discardLifeTipIntent,
                            child: const Text('이전 요청 지우기'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_lifeTipIntentError != null)
                  _ErrorPanel(
                    message: '저장된 꿀팁 활동 요청을 읽지 못했어요.',
                    onRefresh: _loadLifeTipIntent,
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
    this.onOpenDiningImport,
    this.onOpenFashionImport,
    this.onOpenBeautyImport,
    this.onOpenTravelImport,
    this.onOpenLifeTipImport,
    super.key,
  });
  final CommonKernelClient client;
  final String activityId;
  final KernelJson contracts;
  final void Function(String importId)? onOpenDiningImport;
  final void Function(String importId)? onOpenFashionImport;
  final void Function(String importId)? onOpenBeautyImport;
  final void Function(String importId)? onOpenTravelImport;
  final void Function(String importId)? onOpenLifeTipImport;

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

  KernelJson? _selectedDiningCandidate() {
    final selection = _objects(
      _board?['tasks'],
    ).where((item) => item['id'] == 'select_place').firstOrNull;
    if (selection == null) return null;
    final result = _objects(
      _board?['results'],
    ).where((item) => item['id'] == selection['latestOutputRef']).firstOrNull;
    final candidateId = _object(result?['value'])['candidateId'];
    return _objects(
      _object(selection['inputBindings'])['candidates'],
    ).where((item) => item['id'] == candidateId).firstOrNull;
  }

  Future<void> _openPlaceMap(KernelJson candidate) async {
    final links = PlaceMapLinks.fromPlace(
      name: _text(candidate['name']),
      searchArea: _text(candidate['searchArea']),
    );
    if (links == null) return;
    try {
      final opened = await launchUrl(
        links.naver,
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('지도 앱을 열지 못했어요.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('지도 앱을 열지 못했어요.')));
      }
    }
  }

  Future<void> _complete(KernelJson task) async {
    final capabilityId = _text(task['capabilityId']);
    if (capabilityId == 'life_tip.confirm_actions') {
      final inputs = _object(_taskInputs(task));
      final factIndexes = await showDialog<List<int>>(
        context: context,
        builder: (_) => LifeTipConfirmDialog(
          title: _text(inputs['title']),
          importId: _text(inputs['importId']),
          candidates: _objects(inputs['candidates']),
          onOpenImport: widget.onOpenLifeTipImport,
        ),
      );
      if (factIndexes == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.confirmLifeTipActions({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'factIndexes': factIndexes,
        });
      });
      return;
    }
    if (capabilityId == 'life_tip.record_outcomes') {
      final plan = _object(_object(_taskInputs(task))['plan']);
      final actions = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) =>
            LifeTipOutcomeDialog(actions: _objects(plan['actions'])),
      );
      if (actions == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.recordLifeTipOutcomes({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'actions': actions,
        });
      });
      return;
    }
    if (capabilityId == 'travel.confirm_itinerary') {
      final inputs = _object(_taskInputs(task));
      final selections = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) => TravelConfirmDialog(
          candidates: _objects(inputs['candidates']),
          startAt: _text(inputs['startAt']),
          onOpenImport: widget.onOpenTravelImport,
        ),
      );
      if (selections == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.confirmTravelItinerary({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'selections': selections,
        });
      });
      return;
    }
    if (capabilityId == 'travel.record_stop_outcomes') {
      final itinerary = _object(_object(_taskInputs(task))['itinerary']);
      final stops = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) =>
            TravelOutcomeDialog(stops: _objects(itinerary['stops'])),
      );
      if (stops == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.recordTravelStopOutcomes({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'stops': stops,
        });
      });
      return;
    }
    if (capabilityId == 'beauty.confirm_routine') {
      final selections = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) => _BeautyConfirmDialog(
          candidates: _objects(_object(_taskInputs(task))['candidates']),
          onOpenImport: widget.onOpenBeautyImport,
        ),
      );
      if (selections == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.confirmBeautyRoutine({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'selections': selections,
        });
      });
      return;
    }
    if (capabilityId == 'beauty.record_routine_outcome') {
      final occurrence = _object(_object(_taskInputs(task))['occurrence']);
      final steps = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) =>
            _BeautyOutcomeDialog(steps: _objects(occurrence['steps'])),
      );
      if (steps == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.recordBeautyRoutineOutcome({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'steps': steps,
        });
      });
      return;
    }
    if (capabilityId == 'fashion.confirm_outfit') {
      final selections = await showDialog<List<KernelJson>>(
        context: context,
        builder: (_) => _FashionConfirmDialog(
          candidates: _objects(_object(_taskInputs(task))['candidates']),
          onOpenImport: widget.onOpenFashionImport,
        ),
      );
      if (selections == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.confirmFashionOutfit({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'selections': selections,
        });
      });
      return;
    }
    if (capabilityId == 'fashion.record_wear_outcome') {
      final status = await showDialog<String>(
        context: context,
        builder: (_) => const _FashionWearDialog(),
      );
      if (status == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.recordFashionWearOutcome({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'status': status,
        });
      });
      return;
    }
    if (capabilityId == 'dining.select_place') {
      final candidates = _objects(_object(_taskInputs(task))['candidates']);
      final candidateId = await showDialog<String>(
        context: context,
        builder: (_) => _DiningPlaceDialog(
          candidates: candidates,
          onOpenImport: widget.onOpenDiningImport,
        ),
      );
      if (candidateId == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.selectDiningPlace({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'candidateId': candidateId,
        });
      });
      return;
    }
    if (capabilityId == 'dining.record_visit_outcome') {
      final status = await showDialog<String>(
        context: context,
        builder: (_) => const _DiningOutcomeDialog(),
      );
      if (status == null || !mounted) return;
      await _mutate((revision, commandId) async {
        await widget.client.recordDiningVisitOutcome({
          'commandId': commandId,
          'activityId': widget.activityId,
          'expectedRevision': revision,
          'status': status,
        });
      });
      return;
    }
    if (capabilityId == 'dining.review_visit_details') {
      final placeId = _text(_object(_taskInputs(task))['placeId']);
      await _command('task.transition', {
        'taskId': task['id'],
        'expectedTaskRevision': task['revision'],
        'to': 'completed',
        'output': {
          'placeId': placeId,
          'status': 'unknown',
          'reviewedAt': DateTime.now().toUtc().toIso8601String(),
        },
      });
      return;
    }
    final cap = _capability(task);
    Object? output;
    if (task['outputSchema'] != null || cap['outputType'] != null) {
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
    final isDining = _text(task['capabilityId']).startsWith('dining.');
    final isFashion = _text(task['capabilityId']).startsWith('fashion.');
    final isBeauty = _text(task['capabilityId']).startsWith('beauty.');
    final isTravel = _text(task['capabilityId']).startsWith('travel.');
    final isLifeTip = _text(task['capabilityId']).startsWith('life_tip.');
    final selectedDiningCandidate = isDining
        ? _selectedDiningCandidate()
        : null;
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
            else if (isDining && task['id'] == 'select_place')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    Text(
                      '• ${_text(candidate['name'])} · ${_text(candidate['searchArea'])} · 캡처 ${_strings(candidate['importIds']).length}개',
                    ),
                  const Text('같은 이름·지역의 캡처는 선택 전 후보로만 묶여 있어요.'),
                ],
              )
            else if (isDining)
              Text(
                task['id'] == 'review_visit_details'
                    ? '방문 전 영업·예약 정보는 아직 확인되지 않았어요. 직접 확인해도 사실로 자동 저장되지는 않아요.'
                    : '실제로 방문했는지 직접 기록해 주세요.',
              )
            else if (isFashion && task['id'] == 'confirm_outfit')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    Text('• ${_text(candidate['name'])} · 캡처 후보'),
                  const Text('색상·사이즈·소유 상태는 원본을 본 뒤 직접 확인해 주세요.'),
                ],
              )
            else if (isFashion)
              const Text('코디를 만들었다고 입은 것은 아니에요. 실제 착용 여부를 기록해 주세요.')
            else if (isBeauty && task['id'] == 'confirm_routine')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    Text('• ${_text(candidate['name'])} · 캡처 후보'),
                  const Text('제품 순서·선택한 옵션·단계 이름은 직접 확인해 주세요.'),
                ],
              )
            else if (isBeauty && task['id'] == 'record_routine_outcome')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final step in _objects(
                    _object(_object(_taskInputs(task))['occurrence'])['steps'],
                  ))
                    Text('• ${_text(step['title'])}'),
                ],
              )
            else if (isBeauty)
              const Text('확정한 루틴의 실행 회차를 만듭니다. 실제 사용은 다음 단계에서 기록해요.')
            else if (isTravel && task['id'] == 'confirm_itinerary')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    Text(
                      '• ${_text(candidate['name'])} · ${_text(candidate['searchArea'])} · 캡처 후보',
                    ),
                  const Text(
                    '장소 순서와 시각은 직접 확인해 주세요. 지도 검색은 정확한 주소나 운영 상태의 확인이 아니에요.',
                  ),
                ],
              )
            else if (isTravel && task['id'] == 'record_stop_outcomes')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final stop in _objects(
                    _object(_object(_taskInputs(task))['itinerary'])['stops'],
                  ))
                    Text(
                      '• ${_text(stop['title'])} · ${_text(stop['plannedAt'])}',
                    ),
                  const Text('예정된 장소가 실제 방문 장소는 아니에요. 방문 여부를 직접 기록해 주세요.'),
                ],
              )
            else if (isLifeTip && task['id'] == 'confirm_actions')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_text(_object(_taskInputs(task))['title'])),
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    Text(
                      '• ${candidate['factIndex']}. ${_text(candidate['text'])}',
                    ),
                  const Text('캡처에서 읽은 단계입니다. 실천할 항목은 직접 골라 주세요.'),
                ],
              )
            else if (isLifeTip && task['id'] == 'record_outcomes')
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final action in _objects(
                    _object(_object(_taskInputs(task))['plan'])['actions'],
                  ))
                    Text('• ${_text(action['text'])}'),
                  const Text('계획과 실제 실행은 별개입니다. 각 단계의 결과를 직접 기록해 주세요.'),
                ],
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
              else if (isFashion)
                _fashionResult(task)
              else if (isBeauty)
                _beautyResult(task)
              else if (isTravel)
                _travelResult(task)
              else if (isLifeTip)
                _lifeTipResult(task)
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
                if (isDining &&
                    task['id'] == 'review_visit_details' &&
                    selectedDiningCandidate != null)
                  OutlinedButton.icon(
                    key: const Key('kernel-open-dining-map'),
                    onPressed: () => _openPlaceMap(selectedDiningCandidate),
                    icon: const Icon(Icons.map_outlined),
                    label: const Text('지도에서 확인'),
                  ),
                if (isDining &&
                    selectedDiningCandidate != null &&
                    widget.onOpenDiningImport != null)
                  for (final importId in _strings(
                    selectedDiningCandidate['importIds'],
                  ))
                    OutlinedButton.icon(
                      key: ValueKey('kernel-open-dining-source-$importId'),
                      onPressed: () => widget.onOpenDiningImport!(importId),
                      icon: const Icon(Icons.image_outlined),
                      label: const Text('저장한 원본 보기'),
                    ),
                if (isBeauty &&
                    task['id'] == 'confirm_routine' &&
                    widget.onOpenBeautyImport != null)
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  ))
                    OutlinedButton.icon(
                      key: ValueKey(
                        'kernel-open-beauty-source-${candidate['importId']}',
                      ),
                      onPressed: () => widget.onOpenBeautyImport!(
                        _text(candidate['importId']),
                      ),
                      icon: const Icon(Icons.image_outlined),
                      label: const Text('저장한 원본 보기'),
                    ),
                if (isTravel && task['id'] == 'confirm_itinerary')
                  for (final candidate in _objects(
                    _object(_taskInputs(task))['candidates'],
                  )) ...[
                    OutlinedButton.icon(
                      key: ValueKey(
                        'kernel-open-travel-map-${candidate['importId']}',
                      ),
                      onPressed: () => _openPlaceMap(candidate),
                      icon: const Icon(Icons.map_outlined),
                      label: Text('${_text(candidate['name'])} 지도 검색'),
                    ),
                    if (widget.onOpenTravelImport != null)
                      OutlinedButton.icon(
                        key: ValueKey(
                          'kernel-open-travel-source-${candidate['importId']}',
                        ),
                        onPressed: () => widget.onOpenTravelImport!(
                          _text(candidate['importId']),
                        ),
                        icon: const Icon(Icons.image_outlined),
                        label: const Text('저장한 원본 보기'),
                      ),
                  ],
                if (isLifeTip &&
                    task['id'] == 'confirm_actions' &&
                    widget.onOpenLifeTipImport != null)
                  OutlinedButton.icon(
                    key: const Key('kernel-open-life-tip-source'),
                    onPressed: () => widget.onOpenLifeTipImport!(
                      _text(_object(_taskInputs(task))['importId']),
                    ),
                    icon: const Icon(Icons.image_outlined),
                    label: const Text('저장한 원본 보기'),
                  ),
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

  Widget _fashionResult(KernelJson task) {
    final result = _objects(
      _board?['results'],
    ).where((item) => item['id'] == task['latestOutputRef']).firstOrNull;
    final value = _object(result?['value']);
    if (task['id'] == 'record_wear') {
      return Text(switch (value['status']) {
        'worn' => '착용 결과: 입었어요',
        'not_worn' => '착용 결과: 안 입었어요',
        _ => '착용 결과: 아직 몰라요',
      });
    }
    final candidates = {
      for (final candidate in _objects(
        _object(task['inputBindings'])['candidates'],
      ))
        _text(candidate['importId']): _text(candidate['name']),
    };
    final items = _objects(_object(value['outfit'])['items']);
    const slots = {
      'outerwear': '겉옷',
      'top': '상의',
      'bottom': '하의',
      'shoes': '신발',
      'accessory': '액세서리',
    };
    const ownership = {
      'owned': '가지고 있음',
      'candidate': '구매 후보',
      'unknown': '소유 미확인',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('확정한 코디'),
        for (final item in items)
          Text(
            '• ${slots[_text(item['slot'])] ?? '옷'} · '
            '${candidates[_text(item['importId'])] ?? '상품'} · '
            '${_text(item['color'])} / ${_text(item['size'])} · '
            '${ownership[_text(item['ownership'])] ?? '소유 미확인'}',
          ),
      ],
    );
  }

  Widget _beautyResult(KernelJson task) {
    final result = _objects(
      _board?['results'],
    ).where((item) => item['id'] == task['latestOutputRef']).firstOrNull;
    final value = _object(result?['value']);
    if (task['id'] == 'confirm_routine') {
      final steps = _objects(_object(value['template'])['steps']);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('확정한 루틴 순서'),
          for (var index = 0; index < steps.length; index++)
            Text('${index + 1}. ${_text(steps[index]['title'])}'),
        ],
      );
    }
    if (task['id'] == 'instantiate_routine') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('생성한 루틴 회차'),
          for (final step in _objects(value['steps']))
            Text('• ${_text(step['title'])}'),
        ],
      );
    }
    if (task['id'] == 'record_routine_outcome') {
      final occurrence = _object(_object(_taskInputs(task))['occurrence']);
      final titles = {
        for (final step in _objects(occurrence['steps']))
          _text(step['templateStepId']): _text(step['title']),
      };
      const statuses = {
        'completed': '사용했어요',
        'skipped': '건너뛰었어요',
        'unknown': '아직 몰라요',
      };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('실제 사용 기록'),
          for (final step in _objects(value['steps']))
            Text(
              '• ${titles[_text(step['templateStepId'])] ?? '단계'} · '
              '${statuses[_text(step['status'])] ?? '상태 미확인'}',
            ),
        ],
      );
    }
    return _JsonDetails(title: '최근 결과', value: result);
  }

  Widget _travelResult(KernelJson task) {
    final result = _objects(
      _board?['results'],
    ).where((item) => item['id'] == task['latestOutputRef']).firstOrNull;
    final value = _object(result?['value']);
    if (task['id'] == 'confirm_itinerary') {
      final stops = _objects(_object(value['itinerary'])['stops']);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('확정한 방문 순서'),
          for (var index = 0; index < stops.length; index++)
            Text(
              '${index + 1}. ${_text(stops[index]['title'])} · ${_text(stops[index]['plannedAt'])}',
            ),
        ],
      );
    }
    if (task['id'] == 'record_stop_outcomes') {
      final itinerary = _object(_object(_taskInputs(task))['itinerary']);
      final titles = {
        for (final stop in _objects(itinerary['stops']))
          _text(stop['id']): _text(stop['title']),
      };
      const statuses = {
        'visited': '다녀왔어요',
        'skipped': '못 갔어요',
        'unknown': '아직 몰라요',
      };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('실제 방문 기록'),
          for (final stop in _objects(value['stops']))
            Text(
              '• ${titles[_text(stop['stopId'])] ?? '장소'} · '
              '${statuses[_text(stop['status'])] ?? '상태 미확인'}',
            ),
        ],
      );
    }
    return _JsonDetails(title: '최근 결과', value: result);
  }

  Widget _lifeTipResult(KernelJson task) {
    final result = _objects(
      _board?['results'],
    ).where((item) => item['id'] == task['latestOutputRef']).firstOrNull;
    final value = _object(result?['value']);
    if (task['id'] == 'confirm_actions') {
      final actions = _objects(_object(value['plan'])['actions']);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('확정한 실천 단계'),
          for (final action in actions)
            Text('${action['order']}. ${_text(action['text'])}'),
        ],
      );
    }
    if (task['id'] == 'record_outcomes') {
      final titles = {
        for (final action in _objects(
          _object(_object(_taskInputs(task))['plan'])['actions'],
        ))
          _text(action['id']): _text(action['text']),
      };
      const statuses = {
        'done': '했어요',
        'skipped': '하지 않았어요',
        'unknown': '아직 몰라요',
      };
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('실제 실행 기록'),
          for (final action in _objects(value['actions']))
            Text(
              '• ${titles[_text(action['actionId'])] ?? '단계'} · '
              '${statuses[_text(action['status'])] ?? '상태 미확인'}',
            ),
        ],
      );
    }
    return _JsonDetails(title: '최근 결과', value: result);
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

final class _BeautyScenarioDialog extends StatefulWidget {
  const _BeautyScenarioDialog({required this.options});

  final List<BeautyImportOption> options;

  @override
  State<_BeautyScenarioDialog> createState() => _BeautyScenarioDialogState();
}

final class _BeautyScenarioDialogState extends State<_BeautyScenarioDialog> {
  final _selected = <String>{};
  final _occasion = TextEditingController();
  final _date = TextEditingController();
  final _time = TextEditingController(text: '21:00');
  String? _error;

  @override
  void initState() {
    super.initState();
    final day = DateTime.now().add(const Duration(days: 1));
    _date.text =
        '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _occasion.dispose();
    _date.dispose();
    _time.dispose();
    super.dispose();
  }

  void _submit() {
    final occasion = _occasion.text.trim();
    final date = _date.text.trim();
    final time = _time.text.trim();
    final when =
        RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) &&
            RegExp(r'^\d{2}:\d{2}$').hasMatch(time)
        ? DateTime.tryParse('${date}T$time:00')
        : null;
    if (_selected.isEmpty ||
        _selected.length > 5 ||
        occasion.isEmpty ||
        occasion.length > 120 ||
        when == null) {
      setState(() => _error = '캡처 1~5개, 루틴 이름과 날짜·시각을 확인해 주세요.');
      return;
    }
    Navigator.pop(context, <String, Object?>{
      'importIds': widget.options
          .where((item) => _selected.contains(item.importId))
          .map((item) => item.importId)
          .toList(),
      'occasion': occasion,
      'scheduledAt': when.toUtc().toIso8601String(),
    });
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 제품으로 스킨케어 루틴'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('제품 캡처를 고르세요. 사용 순서와 실제 선택한 제품 옵션은 계획 승인 후 직접 확인합니다.'),
            for (final option in widget.options)
              CheckboxListTile(
                key: ValueKey('beauty-import-${option.importId}'),
                contentPadding: EdgeInsets.zero,
                value: _selected.contains(option.importId),
                title: Text(option.title),
                onChanged: (checked) => setState(() {
                  if (checked == true) {
                    _selected.add(option.importId);
                  } else {
                    _selected.remove(option.importId);
                  }
                }),
              ),
            TextField(
              controller: _occasion,
              decoration: const InputDecoration(labelText: '루틴 이름·상황'),
            ),
            TextField(
              controller: _date,
              decoration: const InputDecoration(labelText: '날짜 (YYYY-MM-DD)'),
            ),
            TextField(
              controller: _time,
              decoration: const InputDecoration(labelText: '시각 (HH:mm)'),
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
        key: const Key('beauty-create-submit'),
        onPressed: _submit,
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class _BeautyConfirmDialog extends StatefulWidget {
  const _BeautyConfirmDialog({required this.candidates, this.onOpenImport});

  final List<KernelJson> candidates;
  final void Function(String importId)? onOpenImport;

  @override
  State<_BeautyConfirmDialog> createState() => _BeautyConfirmDialogState();
}

final class _BeautyConfirmDialogState extends State<_BeautyConfirmDialog> {
  final _included = <String>{};
  final _orderedIds = <String>[];
  final _variant = <String, TextEditingController>{};
  final _stepTitle = <String, TextEditingController>{};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final candidate in widget.candidates) {
      final id = _text(candidate['importId']);
      if (id.isEmpty) continue;
      _orderedIds.add(id);
      _included.add(id);
      _variant[id] = TextEditingController();
      _stepTitle[id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final controller in [..._variant.values, ..._stepTitle.values]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _move(int index, int offset) {
    var target = index + offset;
    while (target >= 0 &&
        target < _orderedIds.length &&
        !_included.contains(_orderedIds[target])) {
      target += offset;
    }
    if (target < 0 || target >= _orderedIds.length) return;
    setState(() {
      final id = _orderedIds[index];
      _orderedIds[index] = _orderedIds[target];
      _orderedIds[target] = id;
    });
  }

  void _submit() {
    final selectedIds = _orderedIds.where(_included.contains).toList();
    if (selectedIds.isEmpty ||
        selectedIds.any((id) {
          final variant = _variant[id]?.text.trim() ?? '';
          final title = _stepTitle[id]?.text.trim() ?? '';
          return variant.isEmpty ||
              variant.length > 80 ||
              title.isEmpty ||
              title.length > 80;
        })) {
      setState(() => _error = '선택한 단계마다 실제 제품 옵션과 단계 이름을 1~80자로 입력해 주세요.');
      return;
    }
    Navigator.pop(context, [
      for (final id in selectedIds)
        <String, Object?>{
          'importId': id,
          'variantLabel': _variant[id]!.text.trim(),
          'stepTitle': _stepTitle[id]!.text.trim(),
        },
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final candidates = {
      for (final candidate in widget.candidates)
        _text(candidate['importId']): candidate,
    };
    return AlertDialog(
      title: const Text('루틴 단계와 순서 확인'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '이미지에서 읽은 상품명은 후보입니다. 사용할 제품 옵션과 순서를 직접 확인해 주세요. 저장만으로 소유나 사용이 기록되지는 않아요.',
              ),
              for (var index = 0; index < _orderedIds.length; index++)
                Builder(
                  builder: (context) {
                    final id = _orderedIds[index];
                    final candidate = candidates[id] ?? {};
                    final included = _included.contains(id);
                    final selectedOrdinal = _orderedIds
                        .take(index + 1)
                        .where(_included.contains)
                        .length;
                    return Card(
                      key: ValueKey('beauty-step-card-$id'),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            CheckboxListTile(
                              key: ValueKey('beauty-confirm-include-$id'),
                              value: included,
                              title: Text(
                                included
                                    ? '$selectedOrdinal. ${_text(candidate['name'])}'
                                    : '${_text(candidate['name'])} · 제외',
                              ),
                              onChanged: (checked) => setState(() {
                                if (checked == true) {
                                  _included.add(id);
                                } else {
                                  _included.remove(id);
                                }
                              }),
                            ),
                            if (included) ...[
                              Wrap(
                                children: [
                                  IconButton(
                                    key: ValueKey('beauty-step-up-$id'),
                                    tooltip: '앞 단계로 이동',
                                    onPressed:
                                        !_orderedIds
                                            .take(index)
                                            .any(_included.contains)
                                        ? null
                                        : () => _move(index, -1),
                                    icon: const Icon(Icons.arrow_upward),
                                  ),
                                  IconButton(
                                    key: ValueKey('beauty-step-down-$id'),
                                    tooltip: '뒤 단계로 이동',
                                    onPressed:
                                        !_orderedIds
                                            .skip(index + 1)
                                            .any(_included.contains)
                                        ? null
                                        : () => _move(index, 1),
                                    icon: const Icon(Icons.arrow_downward),
                                  ),
                                  if (widget.onOpenImport != null)
                                    TextButton.icon(
                                      key: ValueKey('beauty-source-$id'),
                                      onPressed: () => widget.onOpenImport!(id),
                                      icon: const Icon(Icons.image_outlined),
                                      label: const Text('원본 캡처 보기'),
                                    ),
                                ],
                              ),
                              TextField(
                                key: ValueKey('beauty-variant-$id'),
                                controller: _variant[id],
                                decoration: const InputDecoration(
                                  labelText: '실제 사용할 제품 옵션',
                                  hintText: '예: 150 mL',
                                ),
                              ),
                              TextField(
                                key: ValueKey('beauty-step-title-$id'),
                                controller: _stepTitle[id],
                                decoration: const InputDecoration(
                                  labelText: '루틴 단계 이름',
                                  hintText: '예: 저녁 세안',
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
          key: const Key('beauty-confirm-submit'),
          onPressed: _submit,
          child: const Text('루틴 확정'),
        ),
      ],
    );
  }
}

final class _BeautyOutcomeDialog extends StatefulWidget {
  const _BeautyOutcomeDialog({required this.steps});

  final List<KernelJson> steps;

  @override
  State<_BeautyOutcomeDialog> createState() => _BeautyOutcomeDialogState();
}

final class _BeautyOutcomeDialogState extends State<_BeautyOutcomeDialog> {
  final _statusByStep = <String, String>{};
  String? _error;

  void _submit() {
    if (widget.steps.isEmpty ||
        widget.steps.any(
          (step) => !_statusByStep.containsKey(_text(step['templateStepId'])),
        )) {
      setState(() => _error = '모든 단계의 실제 사용 여부를 선택해 주세요.');
      return;
    }
    Navigator.pop(context, [
      for (final step in widget.steps)
        <String, Object?>{
          'templateStepId': step['templateStepId'],
          'status': _statusByStep[_text(step['templateStepId'])],
        },
    ]);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 루틴 사용 기록'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('계획에 넣은 제품과 실제 사용은 별도예요. 각 단계를 직접 기록해 주세요.'),
            for (final step in widget.steps)
              DropdownButtonFormField<String>(
                key: ValueKey('beauty-outcome-${step['templateStepId']}'),
                initialValue: _statusByStep[_text(step['templateStepId'])],
                decoration: InputDecoration(labelText: _text(step['title'])),
                items: const [
                  DropdownMenuItem(value: 'completed', child: Text('사용했어요')),
                  DropdownMenuItem(value: 'skipped', child: Text('건너뛰었어요')),
                  DropdownMenuItem(value: 'unknown', child: Text('아직 몰라요')),
                ],
                onChanged: (value) => setState(() {
                  if (value != null) {
                    _statusByStep[_text(step['templateStepId'])] = value;
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
        key: const Key('beauty-outcome-submit'),
        onPressed: _submit,
        child: const Text('사용 결과 저장'),
      ),
    ],
  );
}

final class _FashionScenarioDialog extends StatefulWidget {
  const _FashionScenarioDialog({required this.options});
  final List<FashionImportOption> options;

  @override
  State<_FashionScenarioDialog> createState() => _FashionScenarioDialogState();
}

final class _FashionScenarioDialogState extends State<_FashionScenarioDialog> {
  final _selected = <String>{};
  final _occasion = TextEditingController();
  final _date = TextEditingController();
  final _time = TextEditingController(text: '18:00');
  String? _error;

  @override
  void initState() {
    super.initState();
    final day = DateTime.now().add(const Duration(days: 1));
    _date.text =
        '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _occasion.dispose();
    _date.dispose();
    _time.dispose();
    super.dispose();
  }

  void _submit() {
    final occasion = _occasion.text.trim();
    final date = _date.text.trim();
    final time = _time.text.trim();
    final when =
        RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) &&
            RegExp(r'^\d{2}:\d{2}$').hasMatch(time)
        ? DateTime.tryParse('${date}T$time:00')
        : null;
    if (_selected.isEmpty ||
        _selected.length > 5 ||
        occasion.isEmpty ||
        occasion.length > 120 ||
        when == null) {
      setState(() => _error = '캡처 1~5개, 일정명과 날짜·시각을 확인해 주세요.');
      return;
    }
    Navigator.pop(context, <String, Object?>{
      'importIds': widget.options
          .where((item) => _selected.contains(item.importId))
          .map((item) => item.importId)
          .toList(),
      'occasion': occasion,
      'scheduledAt': when.toUtc().toIso8601String(),
    });
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 옷으로 코디 계획'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('옷 캡처를 고르세요. 실제 색상·사이즈와 소유 여부는 계획 승인 후 직접 확인합니다.'),
            for (final option in widget.options)
              CheckboxListTile(
                key: ValueKey('fashion-import-${option.importId}'),
                contentPadding: EdgeInsets.zero,
                value: _selected.contains(option.importId),
                title: Text(option.title),
                onChanged: (checked) => setState(() {
                  if (checked == true) {
                    _selected.add(option.importId);
                  } else {
                    _selected.remove(option.importId);
                  }
                }),
              ),
            TextField(
              controller: _occasion,
              decoration: const InputDecoration(labelText: '입을 일정·상황'),
            ),
            TextField(
              controller: _date,
              decoration: const InputDecoration(labelText: '날짜 (YYYY-MM-DD)'),
            ),
            TextField(
              controller: _time,
              decoration: const InputDecoration(labelText: '시각 (HH:mm)'),
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
        key: const Key('fashion-create-submit'),
        onPressed: _submit,
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class _FashionConfirmDialog extends StatefulWidget {
  const _FashionConfirmDialog({required this.candidates, this.onOpenImport});
  final List<KernelJson> candidates;
  final void Function(String importId)? onOpenImport;

  @override
  State<_FashionConfirmDialog> createState() => _FashionConfirmDialogState();
}

final class _FashionConfirmDialogState extends State<_FashionConfirmDialog> {
  static const _slots = ['outerwear', 'top', 'bottom', 'shoes', 'accessory'];
  static const _slotLabels = ['겉옷', '상의', '하의', '신발', '액세서리'];
  final _included = <String>{};
  final _slot = <String, String>{};
  final _ownership = <String, String>{};
  final _color = <String, TextEditingController>{};
  final _size = <String, TextEditingController>{};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (var index = 0; index < widget.candidates.length; index++) {
      final id = _text(widget.candidates[index]['importId']);
      _included.add(id);
      _slot[id] = '';
      _ownership[id] = 'unknown';
      _color[id] = TextEditingController();
      _size[id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final controller in [..._color.values, ..._size.values]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final selected = widget.candidates
        .where((item) => _included.contains(_text(item['importId'])))
        .toList();
    final slots = selected
        .map((item) => _slot[_text(item['importId'])])
        .toList();
    if (selected.isEmpty ||
        slots.any((slot) => slot == null || slot.isEmpty) ||
        slots.toSet().length != slots.length ||
        selected.any((item) {
          final id = _text(item['importId']);
          final color = _color[id]?.text.trim() ?? '';
          final size = _size[id]?.text.trim() ?? '';
          return color.isEmpty ||
              color.length > 80 ||
              size.isEmpty ||
              size.length > 80;
        })) {
      setState(() => _error = '코디 자리는 겹치지 않게, 선택한 색상·사이즈는 직접 입력해 주세요.');
      return;
    }
    Navigator.pop(
      context,
      selected.map((item) {
        final id = _text(item['importId']);
        return <String, Object?>{
          'importId': id,
          'slot': _slot[id],
          'color': _color[id]!.text.trim(),
          'size': _size[id]!.text.trim(),
          'ownership': _ownership[id],
        };
      }).toList(),
    );
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('코디 항목 확인'),
    content: SizedBox(
      width: 450,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '이미지의 옵션 목록과 내가 고른 옵션은 달라요. 실제 선택한 색상·사이즈와 소유 여부만 입력해 주세요.',
            ),
            for (final candidate in widget.candidates)
              Builder(
                builder: (context) {
                  final id = _text(candidate['importId']);
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CheckboxListTile(
                            key: ValueKey('fashion-confirm-include-$id'),
                            value: _included.contains(id),
                            title: Text(_text(candidate['name'])),
                            onChanged: (checked) => setState(() {
                              if (checked == true) {
                                _included.add(id);
                              } else {
                                _included.remove(id);
                              }
                            }),
                          ),
                          if (_included.contains(id)) ...[
                            if (widget.onOpenImport != null)
                              TextButton.icon(
                                key: ValueKey('fashion-source-$id'),
                                onPressed: () => widget.onOpenImport!(id),
                                icon: const Icon(Icons.image_outlined),
                                label: const Text('원본 캡처 보기'),
                              ),
                            DropdownButtonFormField<String>(
                              key: ValueKey('fashion-slot-$id'),
                              initialValue: _slot[id]!.isEmpty
                                  ? null
                                  : _slot[id],
                              decoration: const InputDecoration(
                                labelText: '코디 자리',
                              ),
                              items: [
                                for (var i = 0; i < _slots.length; i++)
                                  DropdownMenuItem(
                                    value: _slots[i],
                                    child: Text(_slotLabels[i]),
                                  ),
                              ],
                              onChanged: (value) => setState(
                                () => _slot[id] = value ?? _slot[id]!,
                              ),
                            ),
                            TextField(
                              key: ValueKey('fashion-color-$id'),
                              controller: _color[id],
                              decoration: const InputDecoration(
                                labelText: '선택한 색상',
                              ),
                            ),
                            TextField(
                              key: ValueKey('fashion-size-$id'),
                              controller: _size[id],
                              decoration: const InputDecoration(
                                labelText: '선택한 사이즈',
                              ),
                            ),
                            DropdownButtonFormField<String>(
                              initialValue: _ownership[id],
                              decoration: const InputDecoration(
                                labelText: '소유 상태',
                              ),
                              items: const [
                                DropdownMenuItem(
                                  value: 'unknown',
                                  child: Text('아직 몰라요'),
                                ),
                                DropdownMenuItem(
                                  value: 'owned',
                                  child: Text('내가 가지고 있어요'),
                                ),
                                DropdownMenuItem(
                                  value: 'candidate',
                                  child: Text('구매 후보예요'),
                                ),
                              ],
                              onChanged: (value) => setState(
                                () => _ownership[id] = value ?? 'unknown',
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
        key: const Key('fashion-confirm-submit'),
        onPressed: _submit,
        child: const Text('코디 확정'),
      ),
    ],
  );
}

final class _FashionWearDialog extends StatelessWidget {
  const _FashionWearDialog();

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 착용 여부'),
    content: const Text('코디를 저장한 것과 실제로 입은 것은 별도로 기록해요.'),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      TextButton(
        key: const Key('fashion-wear-unknown'),
        onPressed: () => Navigator.pop(context, 'unknown'),
        child: const Text('아직 몰라요'),
      ),
      TextButton(
        key: const Key('fashion-wear-not-worn'),
        onPressed: () => Navigator.pop(context, 'not_worn'),
        child: const Text('안 입었어요'),
      ),
      FilledButton(
        key: const Key('fashion-wear-worn'),
        onPressed: () => Navigator.pop(context, 'worn'),
        child: const Text('입었어요'),
      ),
    ],
  );
}

final class _DiningScenarioDialog extends StatefulWidget {
  const _DiningScenarioDialog({required this.options});
  final List<DiningImportOption> options;

  @override
  State<_DiningScenarioDialog> createState() => _DiningScenarioDialogState();
}

final class _DiningScenarioDialogState extends State<_DiningScenarioDialog> {
  final _selected = <String>{};
  final _area = TextEditingController();
  final _date = TextEditingController();
  final _time = TextEditingController(text: '19:00');
  final _partySize = TextEditingController(text: '2');
  String? _error;

  @override
  void initState() {
    super.initState();
    final day = DateTime.now().add(const Duration(days: 1));
    _date.text =
        '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _area.dispose();
    _date.dispose();
    _time.dispose();
    _partySize.dispose();
    super.dispose();
  }

  void _submit() {
    final area = _area.text.trim();
    final partySize = int.tryParse(_partySize.text.trim());
    final date = _date.text.trim();
    final time = _time.text.trim();
    final when =
        RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) &&
            RegExp(r'^\d{2}:\d{2}$').hasMatch(time)
        ? DateTime.tryParse('${date}T$time:00')
        : null;
    if (_selected.isEmpty ||
        area.isEmpty ||
        area.length > 80 ||
        partySize == null ||
        partySize < 1 ||
        partySize > 20 ||
        when == null) {
      setState(() => _error = '캡처, 지역, 방문 시각과 인원(1~20명)을 확인해 주세요.');
      return;
    }
    Navigator.pop(context, <String, Object?>{
      'importIds': widget.options
          .where((item) => _selected.contains(item.importId))
          .map((item) => item.importId)
          .toList(),
      'area': area,
      'scheduledAt': when.toUtc().toIso8601String(),
      'partySize': partySize,
    });
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 맛집으로 식사 계획'),
    content: SizedBox(
      width: 430,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('함께 비교할 식당 캡처를 골라 주세요. 같은 지점인지 마지막에 직접 확인합니다.'),
            for (final option in widget.options)
              CheckboxListTile(
                key: ValueKey('dining-import-${option.importId}'),
                contentPadding: EdgeInsets.zero,
                value: _selected.contains(option.importId),
                title: Text(option.placeName),
                subtitle: Text('${option.searchArea} · ${option.title}'),
                onChanged: (checked) => setState(() {
                  if (checked == true) {
                    _selected.add(option.importId);
                    if (_area.text.isEmpty) _area.text = option.searchArea;
                  } else {
                    _selected.remove(option.importId);
                  }
                }),
              ),
            TextField(
              controller: _area,
              decoration: const InputDecoration(labelText: '식사할 지역'),
            ),
            TextField(
              controller: _date,
              decoration: const InputDecoration(labelText: '날짜 (YYYY-MM-DD)'),
            ),
            TextField(
              controller: _time,
              decoration: const InputDecoration(labelText: '시각 (HH:mm)'),
            ),
            TextField(
              controller: _partySize,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '인원'),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
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
        key: const Key('dining-create-submit'),
        onPressed: _submit,
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class _DiningPlaceDialog extends StatelessWidget {
  const _DiningPlaceDialog({required this.candidates, this.onOpenImport});
  final List<KernelJson> candidates;
  final void Function(String importId)? onOpenImport;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('방문할 지점 선택'),
    content: SizedBox(
      width: 400,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('캡처에 적힌 상호와 지역을 확인해 주세요. 선택한 캡처만 같은 지점으로 연결돼요.'),
            const SizedBox(height: 8),
            for (final candidate in candidates)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ListTile(
                    key: ValueKey('dining-candidate-${candidate['id']}'),
                    title: Text(_text(candidate['name'])),
                    subtitle: Text(
                      '${_text(candidate['searchArea'])} · 캡처 ${_strings(candidate['importIds']).length}개',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.pop(context, _text(candidate['id'])),
                  ),
                  if (onOpenImport != null)
                    for (final importId in _strings(candidate['importIds']))
                      TextButton.icon(
                        key: ValueKey('dining-source-$importId'),
                        onPressed: () => onOpenImport!(importId),
                        icon: const Icon(Icons.image_outlined),
                        label: const Text('원본 캡처 보기'),
                      ),
                ],
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
    ],
  );
}

final class _DiningOutcomeDialog extends StatelessWidget {
  const _DiningOutcomeDialog();

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('방문 결과 기록'),
    content: const Text('직접 방문한 경우에만 방문 기록을 만들어요.'),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      TextButton(
        key: const Key('dining-outcome-unknown'),
        onPressed: () => Navigator.pop(context, 'unknown'),
        child: const Text('아직 몰라요'),
      ),
      TextButton(
        key: const Key('dining-outcome-not-visited'),
        onPressed: () => Navigator.pop(context, 'not_visited'),
        child: const Text('못 갔어요'),
      ),
      FilledButton(
        key: const Key('dining-outcome-visited'),
        onPressed: () => Navigator.pop(context, 'visited'),
        child: const Text('다녀왔어요'),
      ),
    ],
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
