import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'analysis_server.dart';

const _kernelToken = String.fromEnvironment('LUFFI_KERNEL_TOKEN');

/// The shared development credential is never used by a release/profile build.
bool get commonKernelDebugEnabled =>
    kDebugMode && _kernelToken.trim().isNotEmpty;

typedef KernelJson = Map<String, Object?>;

/// One durable request body is retained until the server confirms it. Reusing
/// the exact commandId after an ambiguous response makes creation replay-safe.
abstract interface class RecipeScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class DiningScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class FashionScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class BeautyScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class TravelScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class LifeTipScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

abstract interface class HealthScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

final class FileHealthScenarioIntentStore implements HealthScenarioIntentStore {
  const FileHealthScenarioIntentStore({this.directoryPath});
  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_health_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        !_nonEmptyText(decoded['importId'])) {
      throw const FormatException('저장된 운동 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed health creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

abstract interface class ShoppingScenarioIntentStore {
  Future<KernelJson?> load();
  Future<void> save(KernelJson request);
  Future<void> clear();
}

final class FileShoppingScenarioIntentStore
    implements ShoppingScenarioIntentStore {
  const FileShoppingScenarioIntentStore({this.directoryPath});
  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_shopping_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['importIds'] is! List ||
        (decoded['importIds'] as List).isEmpty ||
        (decoded['importIds'] as List).length > 8 ||
        !(decoded['importIds'] as List).every(_nonEmptyText) ||
        (decoded['importIds'] as List).toSet().length !=
            (decoded['importIds'] as List).length ||
        !_nonEmptyText(decoded['purpose']) ||
        (decoded.containsKey('priceReviews') &&
            (decoded['priceReviews'] is! List ||
                !(decoded['priceReviews'] as List).every(
                  (item) =>
                      item is Map &&
                      _nonEmptyText(item['importId']) &&
                      _nonEmptyText(item['sourcePath']) &&
                      _nonEmptyText(item['commandId']) &&
                      (decoded['importIds'] as List).contains(item['importId']),
                )))) {
      throw const FormatException('저장된 쇼핑 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError(
        'An unconfirmed shopping creation intent already exists',
      );
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileLifeTipScenarioIntentStore
    implements LifeTipScenarioIntentStore {
  const FileLifeTipScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_life_tip_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        !_nonEmptyText(decoded['importId'])) {
      throw const FormatException('저장된 생활 꿀팁 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError(
        'An unconfirmed life-tip creation intent already exists',
      );
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileTravelScenarioIntentStore implements TravelScenarioIntentStore {
  const FileTravelScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_travel_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['importIds'] is! List ||
        (decoded['importIds'] as List).isEmpty ||
        !(decoded['importIds'] as List).every(_nonEmptyText) ||
        !_nonEmptyText(decoded['area']) ||
        !_nonEmptyText(decoded['startAt'])) {
      throw const FormatException('저장된 여행 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed travel creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileBeautyScenarioIntentStore implements BeautyScenarioIntentStore {
  const FileBeautyScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_beauty_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['importIds'] is! List ||
        !(decoded['importIds'] as List).every(_nonEmptyText) ||
        !_nonEmptyText(decoded['occasion']) ||
        !_nonEmptyText(decoded['scheduledAt'])) {
      throw const FormatException('저장된 뷰티 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed beauty creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileFashionScenarioIntentStore
    implements FashionScenarioIntentStore {
  const FileFashionScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_fashion_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['importIds'] is! List ||
        !(decoded['importIds'] as List).every(_nonEmptyText)) {
      throw const FormatException('저장된 패션 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed fashion creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileDiningScenarioIntentStore implements DiningScenarioIntentStore {
  const FileDiningScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_dining_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['importIds'] is! List ||
        !(decoded['importIds'] as List).every(_nonEmptyText)) {
      throw const FormatException('저장된 맛집 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed dining creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

final class FileRecipeScenarioIntentStore implements RecipeScenarioIntentStore {
  const FileRecipeScenarioIntentStore({this.directoryPath});

  final String? directoryPath;

  Future<File> _file() async {
    final directory = directoryPath == null
        ? await getApplicationSupportDirectory()
        : Directory(directoryPath!);
    await directory.create(recursive: true);
    return File('${directory.path}/luffi_recipe_scenario_intent.json');
  }

  @override
  Future<KernelJson?> load() async {
    final file = await _file();
    if (!await file.exists()) return null;
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map<String, dynamic> ||
        !_nonEmptyText(decoded['commandId']) ||
        !_nonEmptyText(decoded['activityId']) ||
        decoded['confirmed'] != true ||
        decoded['recipe'] is! Map<String, dynamic>) {
      throw const FormatException('저장된 레시피 생성 요청 형식이 올바르지 않아요.');
    }
    return Map<String, Object?>.from(decoded);
  }

  @override
  Future<void> save(KernelJson request) async {
    final file = await _file();
    if (await file.exists()) {
      throw StateError('An unconfirmed recipe creation intent already exists');
    }
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(request), flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

bool _nonEmptyText(Object? value) => value is String && value.isNotEmpty;
bool _nonNegativeInt(Object? value) => value is int && value >= 0;

bool _validBoardSummary(Object? value) {
  if (value is! Map<String, dynamic>) return false;
  return _nonEmptyText(value['id']) &&
      value['title'] is String &&
      _nonEmptyText(value['lifecycle']) &&
      _nonNegativeInt(value['revision']) &&
      _nonNegativeInt(value['taskCount']) &&
      _nonNegativeInt(value['readyTaskCount']) &&
      _nonNegativeInt(value['pendingChangeCount']) &&
      _nonNegativeInt(value['pendingProposalCount']);
}

final class KernelBoardPage {
  const KernelBoardPage({required this.boards, required this.nextCursor});

  final List<KernelJson> boards;
  final String? nextCursor;
}

abstract interface class CommonKernelClient {
  Future<KernelJson> contracts();
  Future<KernelBoardPage> listBoardsPage({int limit = 20, String? cursor});
  Future<KernelJson> getBoard(String activityId);
  Future<List<KernelJson>> listScenarioConnections(String activityId);
  Future<KernelJson> createScenarioConnection(KernelJson request);
  Future<KernelJson> deleteScenarioConnection(KernelJson request);
  Future<KernelJson> command(KernelJson command);
  Future<KernelJson> createRecipeScenario(KernelJson request);
  Future<KernelJson> createDiningScenario(KernelJson request);
  Future<KernelJson> selectDiningPlace(KernelJson request);
  Future<KernelJson> recordDiningVisitOutcome(KernelJson request);
  Future<KernelJson> createFashionScenario(KernelJson request);
  Future<KernelJson> confirmFashionOutfit(KernelJson request);
  Future<KernelJson> recordFashionWearOutcome(KernelJson request);
  Future<KernelJson> createBeautyScenario(KernelJson request);
  Future<KernelJson> confirmBeautyRoutine(KernelJson request);
  Future<KernelJson> recordBeautyRoutineOutcome(KernelJson request);
  Future<KernelJson> createTravelScenario(KernelJson request);
  Future<KernelJson> confirmTravelItinerary(KernelJson request);
  Future<KernelJson> recordTravelStopOutcomes(KernelJson request);
  Future<KernelJson> createLifeTipScenario(KernelJson request);
  Future<KernelJson> confirmLifeTipActions(KernelJson request);
  Future<KernelJson> recordLifeTipOutcomes(KernelJson request);
  Future<KernelJson> createShoppingScenario(KernelJson request);
  Future<KernelJson> getImportedFieldReview(String importId);
  Future<KernelJson> reviewImportedField(KernelJson request);
  Future<KernelJson> confirmShoppingChoice(KernelJson request);
  Future<KernelJson> recordShoppingPurchaseOutcome(KernelJson request);
  Future<KernelJson> createHealthScenario(KernelJson request);
  Future<KernelJson> confirmHealthExercises(KernelJson request);
  Future<KernelJson> recordHealthExerciseOutcomes(KernelJson request);
  Future<KernelJson> acceptProposal({
    required String proposalId,
    required String commandId,
  });
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  });
}

final class CommonKernelException implements Exception {
  const CommonKernelException(this.code, this.message, {this.statusCode});

  final String code;
  final String message;
  final int? statusCode;

  bool get isRevisionConflict =>
      code == 'REVISION_CONFLICT' || code == 'CONTEXT_STALE';

  @override
  String toString() => message;
}

String newKernelCommandId() {
  final random = Random.secure();
  return List.generate(
    16,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

final class HttpCommonKernelClient implements CommonKernelClient {
  const HttpCommonKernelClient({
    this.baseUrl,
    this.token = _kernelToken,
    this.timeout = const Duration(seconds: 20),
  });

  final String? baseUrl;
  final String token;
  final Duration timeout;

  @override
  Future<KernelJson> contracts() => _request('GET', '/v1/kernel/contracts');

  @override
  Future<KernelBoardPage> listBoardsPage({
    int limit = 20,
    String? cursor,
  }) async {
    if (limit < 1 || limit > 100) {
      throw const CommonKernelException(
        'INVALID_REQUEST',
        '한 번에 불러올 활동 수는 1~100개여야 해요.',
      );
    }
    final query = <String, String>{'limit': '$limit'};
    if (cursor != null) query['cursor'] = cursor;
    final path = Uri(
      path: '/v1/kernel/board-summaries',
      queryParameters: query,
    ).toString();
    final response = await _request('GET', path);
    final boards = response['boards'];
    final nextCursor = response['nextCursor'];
    if (boards is! List ||
        !boards.every(_validBoardSummary) ||
        (nextCursor != null && !_nonEmptyText(nextCursor))) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '활동 목록의 응답 형식을 확인해 주세요.',
      );
    }
    return KernelBoardPage(
      boards: boards
          .map(
            (board) => Map<String, Object?>.from(board as Map<String, dynamic>),
          )
          .toList(),
      nextCursor: nextCursor as String?,
    );
  }

  @override
  Future<KernelJson> getBoard(String activityId) async {
    final board = await _request(
      'GET',
      '/v1/kernel/boards/${Uri.encodeComponent(activityId)}',
    );
    if (board['id'] != activityId || !_nonNegativeInt(board['revision'])) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '활동의 응답 형식을 확인해 주세요.',
      );
    }
    return board;
  }

  @override
  Future<List<KernelJson>> listScenarioConnections(String activityId) async {
    final response = await _request(
      'GET',
      '/v1/kernel/scenario-connections/${Uri.encodeComponent(activityId)}',
    );
    final connections = response['connections'];
    if (connections is! List ||
        !connections.every(
          (item) =>
              item is Map &&
              _nonEmptyText(item['id']) &&
              _nonEmptyText(item['otherActivityId']) &&
              _nonEmptyText(item['kind']),
        )) {
      throw const CommonKernelException(
        'INVALID_RESPONSE',
        '활동 연결 응답을 확인해 주세요.',
      );
    }
    return connections
        .map((item) => Map<String, Object?>.from(item as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<KernelJson> createScenarioConnection(KernelJson request) =>
      _request('POST', '/v1/kernel/scenario-connections', request);

  @override
  Future<KernelJson> deleteScenarioConnection(KernelJson request) =>
      _request('POST', '/v1/kernel/scenario-connections/delete', request);

  @override
  Future<KernelJson> command(KernelJson command) =>
      _request('POST', '/v1/kernel/activities/commands', command);

  @override
  Future<KernelJson> createRecipeScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/recipe/scenarios', request);

  @override
  Future<KernelJson> createDiningScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/dining/scenarios', request);

  @override
  Future<KernelJson> selectDiningPlace(KernelJson request) =>
      _request('POST', '/v1/kernel/dining/select-place', request);

  @override
  Future<KernelJson> recordDiningVisitOutcome(KernelJson request) =>
      _request('POST', '/v1/kernel/dining/visit-outcome', request);

  @override
  Future<KernelJson> createFashionScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/fashion/scenarios', request);

  @override
  Future<KernelJson> confirmFashionOutfit(KernelJson request) =>
      _request('POST', '/v1/kernel/fashion/confirm-outfit', request);

  @override
  Future<KernelJson> recordFashionWearOutcome(KernelJson request) =>
      _request('POST', '/v1/kernel/fashion/wear-outcome', request);

  @override
  Future<KernelJson> createBeautyScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/beauty/scenarios', request);

  @override
  Future<KernelJson> confirmBeautyRoutine(KernelJson request) =>
      _request('POST', '/v1/kernel/beauty/confirm-routine', request);

  @override
  Future<KernelJson> recordBeautyRoutineOutcome(KernelJson request) =>
      _request('POST', '/v1/kernel/beauty/routine-outcome', request);

  @override
  Future<KernelJson> createTravelScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/travel/scenarios', request);

  @override
  Future<KernelJson> confirmTravelItinerary(KernelJson request) =>
      _request('POST', '/v1/kernel/travel/confirm-itinerary', request);

  @override
  Future<KernelJson> recordTravelStopOutcomes(KernelJson request) =>
      _request('POST', '/v1/kernel/travel/stop-outcomes', request);

  @override
  Future<KernelJson> createLifeTipScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/life-tip/scenarios', request);

  @override
  Future<KernelJson> confirmLifeTipActions(KernelJson request) =>
      _request('POST', '/v1/kernel/life-tip/confirm-actions', request);

  @override
  Future<KernelJson> recordLifeTipOutcomes(KernelJson request) =>
      _request('POST', '/v1/kernel/life-tip/outcomes', request);

  @override
  Future<KernelJson> createShoppingScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/shopping/scenarios', request);

  @override
  Future<KernelJson> getImportedFieldReview(String importId) => _request(
    'GET',
    '/v1/kernel/ingestion/field-reviews/${Uri.encodeComponent(importId)}'
        '?fieldKey=shopping.displayed_price',
  );

  @override
  Future<KernelJson> reviewImportedField(KernelJson request) =>
      _request('POST', '/v1/kernel/ingestion/field-reviews', request);

  @override
  Future<KernelJson> confirmShoppingChoice(KernelJson request) =>
      _request('POST', '/v1/kernel/shopping/confirm-choice', request);

  @override
  Future<KernelJson> recordShoppingPurchaseOutcome(KernelJson request) =>
      _request('POST', '/v1/kernel/shopping/purchase-outcome', request);

  @override
  Future<KernelJson> createHealthScenario(KernelJson request) =>
      _request('POST', '/v1/kernel/health/scenarios', request);

  @override
  Future<KernelJson> confirmHealthExercises(KernelJson request) =>
      _request('POST', '/v1/kernel/health/confirm-exercises', request);

  @override
  Future<KernelJson> recordHealthExerciseOutcomes(KernelJson request) =>
      _request('POST', '/v1/kernel/health/exercise-outcomes', request);

  @override
  Future<KernelJson> acceptProposal({
    required String proposalId,
    required String commandId,
  }) => _request('POST', '/v1/kernel/planning/accept', {
    'proposalId': proposalId,
    'commandId': commandId,
  });

  @override
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  }) => _request('POST', '/v1/kernel/activities/run-task', {
    'activityId': activityId,
    'taskId': taskId,
    'expectedRevision': expectedRevision,
    'commandId': commandId,
  });

  Future<KernelJson> _request(
    String method,
    String path, [
    KernelJson? body,
  ]) async {
    if (!kDebugMode || token.trim().isEmpty) {
      throw const CommonKernelException(
        'DEVELOPMENT_ONLY',
        '공통 활동은 토큰이 설정된 개발 빌드에서만 열 수 있어요.',
      );
    }
    final base = Uri.tryParse(baseUrl ?? defaultAnalysisBaseUrl());
    if (base == null ||
        !const {'http', 'https'}.contains(base.scheme) ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty) {
      throw const CommonKernelException(
        'INVALID_SERVER_URL',
        '개발 서버 주소를 확인해 주세요.',
      );
    }
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      // The deadline covers the entire exchange, including a slowly streamed
      // response. A per-chunk timeout would allow an endless trickle.
      return await _exchange(
        client,
        method,
        base.resolve(path),
        body,
      ).timeout(timeout);
    } on TimeoutException {
      throw const CommonKernelException(
        'NETWORK_TIMEOUT',
        '응답을 기다리는 시간이 길어졌어요. 새로고침으로 현재 상태를 확인해 주세요.',
      );
    } on SocketException {
      throw const CommonKernelException(
        'NETWORK_UNAVAILABLE',
        '개발 서버에 연결할 수 없어요. 주소와 서버 실행 상태를 확인해 주세요.',
      );
    } on HttpException {
      throw const CommonKernelException(
        'NETWORK_UNAVAILABLE',
        '연결이 끊겼어요. 새로고침으로 현재 상태를 확인해 주세요.',
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<KernelJson> _exchange(
    HttpClient client,
    String method,
    Uri uri,
    KernelJson? body,
  ) async {
    final request = await client.openUrl(method, uri);
    // Do not forward the development token to a redirect destination.
    request.followRedirects = false;
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close();
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > 4 * 1024 * 1024) {
        throw const CommonKernelException(
          'RESPONSE_TOO_LARGE',
          '응답이 너무 커서 표시할 수 없어요.',
        );
      }
    }
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(bytes));
    } on FormatException {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw CommonKernelException(
          'HTTP_ERROR',
          '요청을 처리하지 못했어요 (${response.statusCode}).',
          statusCode: response.statusCode,
        );
      }
      throw CommonKernelException(
        'INVALID_RESPONSE',
        '개발 서버가 올바른 JSON 응답을 보내지 않았어요.',
        statusCode: response.statusCode,
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw CommonKernelException(
        response.statusCode < 200 || response.statusCode >= 300
            ? 'HTTP_ERROR'
            : 'INVALID_RESPONSE',
        response.statusCode < 200 || response.statusCode >= 300
            ? '요청을 처리하지 못했어요 (${response.statusCode}).'
            : '개발 서버의 응답 형식을 확인해 주세요.',
        statusCode: response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded['error'];
      throw CommonKernelException(
        error is Map && error['code'] is String
            ? error['code'] as String
            : 'HTTP_ERROR',
        error is Map && error['message'] is String
            ? error['message'] as String
            : '요청을 처리하지 못했어요 (${response.statusCode}).',
        statusCode: response.statusCode,
      );
    }
    return Map<String, Object?>.from(decoded);
  }
}
