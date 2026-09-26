import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/common_boards_screen.dart';
import 'package:ori_beauty/features/boards/travel_scenario_dialogs.dart';
import 'package:ori_beauty/features/boards/life_tip_scenario_dialogs.dart';
import 'package:ori_beauty/features/boards/shopping_scenario_dialogs.dart';

KernelJson _board() => {
  'id': 'activity-1',
  'title': '토요일 준비',
  'goal': {'description': '저장한 정보로 외출 준비'},
  'revision': 7,
  'lifecycle': 'active',
  'nextActions': ['task-Z'],
  'tasks': [
    {
      'id': 'task-Z',
      'title': '먼저 할 일',
      'revision': 2,
      'kind': 'action',
      'capabilityId': 'user.action',
      'executionStatus': 'not_started',
      'rendererKey': 'future.unknown',
      'evidenceBindings': ['evidence-42'],
      'readiness': {'status': 'ready', 'inputs': {}, 'reasons': []},
    },
    {
      'id': 'task-A',
      'title': '조건을 기다리는 일',
      'revision': 1,
      'kind': 'action',
      'capabilityId': 'user.action',
      'executionStatus': 'not_started',
      'readiness': {
        'status': 'blocked',
        'reasons': ['예약 결과를 기다리고 있어요.'],
      },
    },
  ],
  'pendingChanges': [
    {
      'eventIds': ['event-9'],
      'timeDue': false,
    },
  ],
  'artifacts': [],
  'results': [],
  'reminders': [],
};

final class FakeRecipeIntentStore implements RecipeScenarioIntentStore {
  KernelJson? pending;
  bool corrupt = false;

  @override
  Future<KernelJson?> load() async {
    if (corrupt) throw const FormatException('corrupt');
    return pending;
  }

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending recipe intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async {
    pending = null;
    corrupt = false;
  }
}

final class FakeDiningIntentStore implements DiningScenarioIntentStore {
  KernelJson? pending;

  @override
  Future<KernelJson?> load() async => pending;

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending dining intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeFashionIntentStore implements FashionScenarioIntentStore {
  KernelJson? pending;

  @override
  Future<KernelJson?> load() async => pending;

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending fashion intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeBeautyIntentStore implements BeautyScenarioIntentStore {
  KernelJson? pending;

  @override
  Future<KernelJson?> load() async => pending;

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending beauty intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeTravelIntentStore implements TravelScenarioIntentStore {
  KernelJson? pending;

  @override
  Future<KernelJson?> load() async => pending;

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending travel intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeLifeTipIntentStore implements LifeTipScenarioIntentStore {
  KernelJson? pending;

  @override
  Future<KernelJson?> load() async => pending;

  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending life-tip intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeShoppingIntentStore implements ShoppingScenarioIntentStore {
  KernelJson? pending;
  @override
  Future<KernelJson?> load() async => pending;
  @override
  Future<void> save(KernelJson request) async {
    if (pending != null) throw StateError('pending shopping intent exists');
    pending = Map<String, Object?>.from(request);
  }

  @override
  Future<void> clear() async => pending = null;
}

final class FakeKernelClient implements CommonKernelClient {
  KernelJson board = _board();
  final commands = <KernelJson>[];
  final runs = <KernelJson>[];
  final scenarioRequests = <KernelJson>[];
  final acceptedProposals = <KernelJson>[];
  bool conflict = false;
  bool commitThenTimeout = false;
  bool failContracts = false;
  bool failRead = false;
  bool failNextPage = false;
  CommonKernelException? scenarioFailure;
  int reads = 0;
  final pageRequests = <String?>[];
  List<KernelJson>? extraBoards;
  KernelJson contract = {
    'packs': [
      {'id': 'recipe', 'version': 1},
    ],
    'capabilities': [
      {'id': 'user.action', 'actor': 'user', 'effect': 'none'},
    ],
  };
  @override
  Future<KernelJson> contracts() async {
    if (failContracts) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '계약 연결 실패');
    }
    return contract;
  }

  @override
  Future<KernelBoardPage> listBoardsPage({
    int limit = 20,
    String? cursor,
  }) async {
    pageRequests.add(cursor);
    if (cursor != null && failNextPage) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '목록 연결 실패');
    }
    final summary = <String, Object?>{
      'id': board['id'],
      'title': board['title'],
      'goal': board['goal'],
      'lifecycle': board['lifecycle'],
      'revision': board['revision'],
      'taskCount': (board['tasks'] as List).length,
      'readyTaskCount': 1,
      'pendingChangeCount': 0,
      'pendingProposalCount': 0,
    };
    if (extraBoards == null) {
      return KernelBoardPage(boards: [summary], nextCursor: null);
    }
    return cursor == null
        ? KernelBoardPage(boards: [summary], nextCursor: 'next-id')
        : KernelBoardPage(boards: extraBoards!, nextCursor: null);
  }

  @override
  Future<KernelJson> getBoard(String activityId) async {
    reads += 1;
    if (failRead) {
      throw const CommonKernelException('NETWORK_UNAVAILABLE', '보드 연결 실패');
    }
    return Map<String, Object?>.from(jsonDecode(jsonEncode(board)) as Map);
  }

  @override
  Future<KernelJson> command(KernelJson command) async {
    commands.add(command);
    if (conflict) {
      throw const CommonKernelException(
        'REVISION_CONFLICT',
        'changed',
        statusCode: 409,
      );
    }
    if (command['type'] == 'activity.create') {
      final payload = command['payload']! as Map;
      board = {
        'id': command['activityId'],
        'title': payload['title'],
        'goal': payload['goal'],
        'revision': 1,
        'lifecycle': 'active',
        'tasks': [],
        'nextActions': [],
      };
    } else {
      final payload = command['payload']! as Map;
      final task = (board['tasks']! as List).cast<Map>().firstWhere(
        (task) => task['id'] == payload['taskId'],
      );
      if (command['type'] == 'task.resolveReview') {
        task['readiness'] = {'status': 'ready', 'inputs': {}, 'reasons': []};
      } else {
        task['executionStatus'] = payload['to'];
      }
      board['revision'] = (board['revision']! as int) + 1;
    }
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {'revision': board['revision']};
  }

  @override
  Future<KernelJson> createRecipeScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    final activityId = request['activityId'];
    if (board['id'] == activityId) {
      return {
        'activityId': activityId,
        'proposalId': 'proposal-1',
        'revision': 1,
        'replayed': true,
      };
    }
    board = {
      'id': activityId,
      'title': (request['recipe'] as Map)['title'],
      'goal': {'description': '샘플 레시피 만들기'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'proposal-1',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'check',
                'title': '재고 확인',
                'capabilityId': 'recipe.check_inventory',
                'inputBindings': {
                  'ingredientIds': ['egg', 'tomato'],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {
      'activityId': activityId,
      'proposalId': 'proposal-1',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> createDiningScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    final activityId = request['activityId'];
    board = {
      'id': activityId,
      'title': '${request['area']} 식사',
      'goal': {'description': '저장한 식당 방문'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'dining-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'select_place',
                'title': '방문할 식당 지점 선택',
                'capabilityId': 'dining.select_place',
                'inputBindings': {
                  'candidates': [
                    {
                      'id': 'candidate-a',
                      'name': '모퉁이식당 성수점',
                      'searchArea': '성수',
                      'importIds': request['importIds'],
                      'mentionIds': ['mention-a'],
                      'evidenceIds': ['evidence-a'],
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    return {
      'activityId': activityId,
      'proposalId': 'dining-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> selectDiningPlace(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'placeId': 'place-a',
      'candidateId': request['candidateId'],
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordDiningVisitOutcome(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'status': request['status'],
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> createFashionScenario(KernelJson request) async {
    scenarioRequests.add(request);
    final activityId = request['activityId'];
    board = {
      'id': activityId,
      'title': '${request['occasion']} 코디',
      'goal': {'description': '저장한 옷으로 코디 만들기'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'fashion-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'confirm_outfit',
                'title': '옷과 옵션·소유 상태 확인',
                'capabilityId': 'fashion.confirm_outfit',
                'inputBindings': {
                  'occasion': request['occasion'],
                  'candidates': [
                    for (final importId in request['importIds'] as List)
                      {
                        'importId': importId,
                        'name': '캡처 상품',
                        'mentionId': 'mention-$importId',
                        'evidenceIds': ['evidence-$importId'],
                      },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    return {
      'activityId': activityId,
      'proposalId': 'fashion-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> confirmFashionOutfit(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'outfitId': 'outfit-a',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordFashionWearOutcome(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'status': request['status'],
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> createBeautyScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    final activityId = request['activityId'];
    if (board['id'] == activityId) {
      return {
        'activityId': activityId,
        'proposalId': 'beauty-proposal',
        'revision': 1,
        'replayed': true,
      };
    }
    board = {
      'id': activityId,
      'title': '${request['occasion']} 루틴',
      'goal': {'description': '저장한 뷰티 제품으로 루틴 만들기'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'beauty-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'confirm_routine',
                'title': '루틴 순서와 제품 옵션 확인',
                'capabilityId': 'beauty.confirm_routine',
                'inputBindings': {
                  'occasion': request['occasion'],
                  'candidates': [
                    for (final importId in request['importIds'] as List)
                      {
                        'importId': importId,
                        'name': '캡처 제품',
                        'mentionId': 'mention-$importId',
                        'evidenceIds': ['evidence-$importId'],
                      },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {
      'activityId': activityId,
      'proposalId': 'beauty-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> confirmBeautyRoutine(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'templateId': 'template-a',
      'occurrenceId': 'occurrence-a',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordBeautyRoutineOutcome(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'occurrenceId': 'occurrence-a',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> createTravelScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    final activityId = request['activityId'];
    if (board['id'] == activityId) {
      return {
        'activityId': activityId,
        'proposalId': 'travel-proposal',
        'revision': 1,
        'replayed': true,
      };
    }
    board = {
      'id': activityId,
      'title': '${request['area']} 하루 여행',
      'goal': {'description': '저장한 여행 장소로 하루 계획 만들기'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'travel-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'confirm_itinerary',
                'title': '장소 순서와 시각 확인',
                'capabilityId': 'travel.confirm_itinerary',
                'inputBindings': {
                  'area': request['area'],
                  'startAt': request['startAt'],
                  'candidates': [
                    for (final importId in request['importIds'] as List)
                      {
                        'importId': importId,
                        'name': '캡처 장소',
                        'searchArea': request['area'],
                        'mentionId': 'mention-$importId',
                        'evidenceIds': ['evidence-$importId'],
                      },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {
      'activityId': activityId,
      'proposalId': 'travel-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> confirmTravelItinerary(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'itineraryId': 'itinerary-a',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordTravelStopOutcomes(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'itineraryId': 'itinerary-a',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> createLifeTipScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    final activityId = request['activityId'];
    if (board['id'] == activityId) {
      return {
        'activityId': activityId,
        'proposalId': 'life-tip-proposal',
        'revision': 1,
        'replayed': true,
      };
    }
    board = {
      'id': activityId,
      'title': '생활 꿀팁 활동',
      'goal': {'description': '생활 꿀팁 실천'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'life-tip-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'confirm_actions',
                'title': '실천할 꿀팁 단계 확인',
                'capabilityId': 'life_tip.confirm_actions',
                'inputBindings': {
                  'importId': request['importId'],
                  'title': '영수증 정리 3단계',
                  'mentionId': 'mention-tip',
                  'candidates': [
                    {
                      'factIndex': 1,
                      'text': '영수증 모으기',
                      'evidenceIds': ['e1'],
                    },
                    {
                      'factIndex': 2,
                      'text': '영수증 나누기',
                      'evidenceIds': ['e2'],
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {
      'activityId': activityId,
      'proposalId': 'life-tip-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> confirmLifeTipActions(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'planId': 'plan-tip',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordLifeTipOutcomes(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'planId': 'plan-tip',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> createShoppingScenario(KernelJson request) async {
    scenarioRequests.add(request);
    if (scenarioFailure case final error?) throw error;
    board = {
      'id': request['activityId'],
      'title': '수납함 쇼핑',
      'goal': {'description': '상품 선택과 구매 결과 기록'},
      'revision': 1,
      'lifecycle': 'active',
      'tasks': <Object?>[],
      'nextActions': <Object?>[],
      'pendingChanges': <Object?>[],
      'pendingProposals': [
        {
          'id': 'shopping-proposal',
          'kind': 'draft',
          'plan': {
            'tasks': [
              {
                'id': 'confirm_choice',
                'title': '상품과 수량 선택',
                'capabilityId': 'shopping.confirm_choice',
                'inputBindings': {
                  'purpose': request['purpose'],
                  'candidates': [
                    {
                      'importId': 'a',
                      'title': '패브릭 수납함',
                      'displayedPriceText': '12,900원',
                      'details': <Object?>[],
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    return {
      'activityId': request['activityId'],
      'proposalId': 'shopping-proposal',
      'revision': 1,
    };
  }

  @override
  Future<KernelJson> confirmShoppingChoice(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {
      'activityId': request['activityId'],
      'choiceId': 'shopping-choice',
      'revision': board['revision'],
    };
  }

  @override
  Future<KernelJson> recordShoppingPurchaseOutcome(KernelJson request) async {
    commands.add(request);
    board['revision'] = (board['revision'] as int) + 1;
    return {'activityId': request['activityId'], 'revision': board['revision']};
  }

  @override
  Future<KernelJson> acceptProposal({
    required String proposalId,
    required String commandId,
  }) async {
    acceptedProposals.add({'proposalId': proposalId, 'commandId': commandId});
    if (conflict) {
      throw const CommonKernelException(
        'CONTEXT_STALE',
        'changed',
        statusCode: 409,
      );
    }
    final proposal = (board['pendingProposals'] as List).cast<Map>().first;
    board['tasks'] = (proposal['plan'] as Map)['tasks'];
    board['pendingProposals'] = <Object?>[];
    board['revision'] = (board['revision'] as int) + 1;
    if (commitThenTimeout) {
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 초과됐어요.');
    }
    return {'revision': board['revision'], 'proposalId': proposalId};
  }

  @override
  Future<KernelJson> runTask({
    required String activityId,
    required String taskId,
    required int expectedRevision,
    required String commandId,
  }) async {
    runs.add({
      'activityId': activityId,
      'taskId': taskId,
      'expectedRevision': expectedRevision,
      'commandId': commandId,
    });
    return {};
  }
}

Future<void> _pump(WidgetTester tester, FakeKernelClient client) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: CommonBoardScreen(
        client: client,
        activityId: 'activity-1',
        contracts: client.contract,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'renders goal, next actions, evidence and pending changes with safe unknown renderer',
    (tester) async {
      final client = FakeKernelClient();
      await _pump(tester, client);
      expect(find.text('저장한 정보로 외출 준비'), findsOneWidget);
      expect(find.textContaining('진행 중 · 버전 7'), findsOneWidget);
      expect(find.text('• 먼저 할 일'), findsOneWidget);
      expect(find.text('근거 ID: evidence-42'), findsOneWidget);
      expect(find.text('일반 요약으로 표시 · future.unknown'), findsOneWidget);
      expect(find.byKey(const Key('kernel-pending-changes')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sends stable task id and current revisions instead of card position',
    (tester) async {
      final client = FakeKernelClient();
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      expect(client.commands.single['activityId'], 'activity-1');
      expect(client.commands.single['expectedRevision'], 7);
      expect(client.commands.single['payload'], {
        'taskId': 'task-Z',
        'expectedTaskRevision': 2,
        'to': 'completed',
      });
      expect(client.commands.single['commandId'], isA<String>());
      final blocked = tester.widget<FilledButton>(
        find.byKey(const Key('kernel-complete-task-A')),
      );
      expect(blocked.onPressed, isNull);
      expect(find.textContaining('진행 중 · 버전 8'), findsOneWidget);
    },
  );

  testWidgets('revision conflict disables writes until explicit refresh', (
    tester,
  ) async {
    final client = FakeKernelClient()..conflict = true;
    await _pump(tester, client);
    await tester.tap(find.byKey(const Key('kernel-start-task-Z')));
    await tester.pumpAndSettle();
    expect(find.textContaining('활동 또는 연결된 정보가 변경됐어요'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
    expect(client.commands.length, 1);
    client.conflict = false;
    client.board['revision'] = 9;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(find.textContaining('진행 중 · 버전 9'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'committed write with lost response requires refresh before retry',
    (tester) async {
      final client = FakeKernelClient()..commitThenTimeout = true;
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-start-task-Z')));
      await tester.pumpAndSettle();
      expect(client.board['revision'], 8);
      expect(client.commands, hasLength(1));
      expect(find.text('응답 시간이 초과됐어요.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('kernel-complete-task-Z')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      expect(client.commands, hasLength(1));
      client.commitThenTimeout = false;
      await tester.tap(find.byKey(const Key('kernel-board-refresh')));
      await tester.pumpAndSettle();
      expect(find.textContaining('버전 8'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('kernel-complete-task-Z')),
            )
            .onPressed,
        isNotNull,
      );
    },
  );

  testWidgets('system calculation calls run-task instead of user completion', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = [
      {'id': 'user.action', 'actor': 'system', 'effect': 'none'},
    ];
    await _pump(tester, client);
    expect(find.byKey(const Key('kernel-complete-task-Z')), findsNothing);
    await tester.tap(find.byKey(const Key('kernel-run-task-Z')));
    await tester.pumpAndSettle();
    expect(client.runs.single['taskId'], 'task-Z');
    expect(client.runs.single['expectedRevision'], 7);
    expect(client.commands, isEmpty);
  });

  testWidgets('list loads contracts and opens an independent common board', (
    tester,
  ) async {
    final client = FakeKernelClient();
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('등록된 분야 recipe'), findsOneWidget);
    expect(find.textContaining('작업 2개'), findsOneWidget);
    await tester.tap(find.byKey(const Key('kernel-board-activity-1')));
    await tester.pumpAndSettle();
    expect(find.byType(CommonBoardScreen), findsOneWidget);
    expect(client.reads, 1);
  });
  testWidgets(
    'activity creation sends title and goal without changing legacy plans',
    (tester) async {
      final client = FakeKernelClient();
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(
            client: client,
            intentStore: FakeRecipeIntentStore(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('활동 만들기'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), '새 외출');
      await tester.enterText(find.byType(TextFormField).at(1), '예약한 식당 방문');
      await tester.tap(find.text('만들기'));
      await tester.pumpAndSettle();
      expect(client.commands.single['type'], 'activity.create');
      expect((client.commands.single['payload'] as Map)['goal'], {
        'description': '예약한 식당 방문',
      });
      expect(find.byType(CommonBoardScreen), findsOneWidget);
      expect(find.text('아직 작업이 없는 활동이에요.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('loads a second summary page without duplicating existing ids', (
    tester,
  ) async {
    final client = FakeKernelClient()
      ..extraBoards = [
        {
          'id': 'activity-1',
          'title': 'duplicate',
          'lifecycle': 'active',
          'revision': 7,
          'taskCount': 2,
        },
        {
          'id': 'activity-2',
          'title': '새 활동',
          'lifecycle': 'active',
          'revision': 1,
          'taskCount': 0,
        },
      ];
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-list-more')));
    await tester.pumpAndSettle();
    expect(client.pageRequests, [null, 'next-id']);
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    expect(find.byKey(const Key('kernel-board-activity-2')), findsOneWidget);
  });

  testWidgets('failed refresh leaves old board visible but disables writes', (
    tester,
  ) async {
    final client = FakeKernelClient();
    await _pump(tester, client);
    client.failRead = true;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(find.text('보드 연결 실패'), findsOneWidget);
    expect(find.text('저장한 정보로 외출 준비'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
    client.failRead = false;
    await tester.tap(find.byKey(const Key('kernel-board-refresh')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('unknown capability remains readable without write actions', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = <Object?>[];
    await _pump(tester, client);
    expect(find.textContaining('읽기 전용으로 표시해요'), findsWidgets);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('board summaries remain browsable when contracts fail', (
    tester,
  ) async {
    final client = FakeKernelClient()..failContracts = true;
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    expect(find.textContaining('읽기 전용으로 열려요'), findsOneWidget);
    await tester.tap(find.byKey(const Key('kernel-board-activity-1')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-complete-task-Z')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('long activity builds task cards as they enter view', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.board['tasks'] = [
      ...(client.board['tasks']! as List),
      for (var index = 0; index < 40; index++)
        {
          'id': 'task-$index',
          'title': '추가 작업 $index',
          'revision': 1,
          'capabilityId': 'user.action',
          'executionStatus': 'not_started',
          'readiness': {'status': 'blocked', 'reasons': []},
        },
    ];
    await _pump(tester, client);
    final lastTask = find.byKey(const Key('kernel-task-task-39'));
    expect(lastTask, findsNothing);
    await tester.scrollUntilVisible(
      lastTask,
      600,
      maxScrolls: 60,
      scrollable: find.byType(Scrollable).first,
    );
    expect(lastTask, findsOneWidget);
  });

  testWidgets('failed second page can retry without losing first page', (
    tester,
  ) async {
    final client = FakeKernelClient()
      ..extraBoards = [
        {
          'id': 'activity-2',
          'title': '새 활동',
          'lifecycle': 'active',
          'revision': 1,
          'taskCount': 0,
        },
      ]
      ..failNextPage = true;
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-list-more')));
    await tester.pumpAndSettle();
    expect(find.text('목록 연결 실패'), findsOneWidget);
    expect(find.byKey(const Key('kernel-board-activity-1')), findsOneWidget);
    client.failNextPage = false;
    await tester.tap(find.text('새로고침'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('kernel-board-activity-2')), findsOneWidget);
  });

  testWidgets(
    'manual result dialog validates JSON then submits completion with output',
    (tester) async {
      final client = FakeKernelClient();
      client.contract['capabilities'] = [
        {
          'id': 'user.action',
          'actor': 'user',
          'effect': 'none',
          'outputType': 'user.result',
        },
      ];
      await _pump(tester, client);
      await tester.tap(find.byKey(const Key('kernel-complete-task-Z')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), 'invalid');
      await tester.tap(find.text('완료 기록'));
      await tester.pump();
      expect(find.text('올바른 JSON을 입력해 주세요.'), findsOneWidget);
      expect(client.commands, isEmpty);
      await tester.enterText(find.byType(TextFormField), '{"confirmed":true}');
      await tester.tap(find.text('완료 기록'));
      await tester.pumpAndSettle();
      expect((client.commands.single['payload'] as Map)['output'], {
        'confirmed': true,
      });
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sample recipe is previewed, then its pending plan needs approval',
    (tester) async {
      final client = FakeKernelClient();
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(
            client: client,
            intentStore: FakeRecipeIntentStore(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-create-sample-recipe')));
      await tester.pumpAndSettle();
      expect(find.textContaining('실제 캡처나 확인된 보유 재료가 아니에요'), findsOneWidget);
      expect(client.scenarioRequests, isEmpty);
      await tester.enterText(
        find.byKey(const Key('kernel-sample-servings')),
        '3',
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('kernel-confirm-sample-recipe')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(
        find.byKey(const Key('kernel-sample-recipe-acknowledge')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-confirm-sample-recipe')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests, hasLength(1));
      final request = client.scenarioRequests.single;
      expect(request['confirmed'], true);
      expect(request['synthetic'], true);
      expect(request['targetServings'], 3);
      expect(request['inventory'], isEmpty);
      expect((request['recipe'] as Map)['title'], contains('샘플'));
      expect((request['recipe'] as Map)['ingredients'], hasLength(3));
      expect(client.acceptedProposals, isEmpty);
      expect(find.text('레시피 계획 제안'), findsOneWidget);
      expect(find.text('아직 작업이 없는 활동이에요.'), findsOneWidget);
      await tester.tap(
        find.byKey(const Key('kernel-approve-proposal-proposal-1')),
      );
      await tester.pumpAndSettle();
      expect(client.acceptedProposals.single['proposalId'], 'proposal-1');
      expect(client.acceptedProposals.single['commandId'], isA<String>());
      expect(find.text('레시피 계획 제안'), findsNothing);
    },
  );

  testWidgets(
    'reviewed restaurant captures create an approval-gated dining board',
    (tester) async {
      final client = FakeKernelClient();
      final intentStore = FakeDiningIntentStore();
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(
            client: client,
            intentStore: FakeRecipeIntentStore(),
            diningIntentStore: intentStore,
            diningImportOptions: const [
              DiningImportOption(
                importId: 'a',
                title: '첫 캡처',
                placeName: '모퉁이식당 성수점',
                searchArea: '성수',
              ),
              DiningImportOption(
                importId: 'd',
                title: '다른 캡처',
                placeName: '성수국수집',
                searchArea: '성수',
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-create-dining')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('dining-import-a')));
      await tester.tap(find.byKey(const ValueKey('dining-import-d')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('dining-create-submit')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests, hasLength(1));
      final request = client.scenarioRequests.single;
      expect(request['importIds'], ['a', 'd']);
      expect(request['area'], '성수');
      expect(request['partySize'], 2);
      expect(request['scheduledAt'], isA<String>());
      expect(intentStore.pending, isNull);
      expect(find.text('계획 제안'), findsOneWidget);
      expect(
        ((client.board['pendingProposals'] as List).single['plan']
            as Map)['tasks'],
        contains(containsPair('title', '방문할 식당 지점 선택')),
      );
    },
  );

  testWidgets(
    'reviewed fashion captures create an approval-gated outfit board',
    (tester) async {
      final client = FakeKernelClient();
      final intentStore = FakeFashionIntentStore();
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(
            client: client,
            intentStore: FakeRecipeIntentStore(),
            diningIntentStore: FakeDiningIntentStore(),
            fashionIntentStore: intentStore,
            fashionImportOptions: const [
              FashionImportOption(importId: 'blazer', title: '차콜 싱글 재킷'),
              FashionImportOption(importId: 'pants', title: '베이지 슬랙스'),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-create-fashion')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('fashion-import-blazer')));
      await tester.tap(find.byKey(const ValueKey('fashion-import-pants')));
      await tester.enterText(
        find.widgetWithText(TextField, '입을 일정·상황'),
        '토요일 모임',
      );
      await tester.tap(find.byKey(const Key('fashion-create-submit')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests, hasLength(1));
      final request = client.scenarioRequests.single;
      expect(request['importIds'], ['blazer', 'pants']);
      expect(request['occasion'], '토요일 모임');
      expect(request['scheduledAt'], isA<String>());
      expect(intentStore.pending, isNull);
      expect(find.text('계획 제안'), findsOneWidget);
      expect(
        ((client.board['pendingProposals'] as List).single['plan']
            as Map)['tasks'],
        contains(containsPair('title', '옷과 옵션·소유 상태 확인')),
      );
    },
  );

  testWidgets(
    'fashion confirmation sends manually selected options and ownership',
    (tester) async {
      final client = FakeKernelClient();
      client.contract = {
        'capabilities': [
          {'id': 'fashion.confirm_outfit', 'actor': 'user', 'effect': 'none'},
        ],
      };
      client.board = {
        'id': 'outfit-test',
        'title': '토요일 모임 코디',
        'goal': {'description': '토요일 모임에 입을 옷 정하기'},
        'revision': 2,
        'lifecycle': 'active',
        'nextActions': ['confirm_outfit'],
        'tasks': [
          {
            'id': 'confirm_outfit',
            'title': '옷과 옵션·소유 상태 확인',
            'revision': 1,
            'capabilityId': 'fashion.confirm_outfit',
            'executionStatus': 'not_started',
            'readiness': {
              'status': 'ready',
              'inputs': {
                'occasion': '토요일 모임',
                'candidates': [
                  {
                    'importId': 'blazer',
                    'name': '차콜 싱글 재킷',
                    'mentionId': 'mention-blazer',
                    'evidenceIds': ['e1'],
                  },
                ],
              },
              'reasons': <Object?>[],
            },
          },
        ],
        'pendingChanges': <Object?>[],
        'pendingProposals': <Object?>[],
        'results': <Object?>[],
        'artifacts': <Object?>[],
        'reminders': <Object?>[],
      };
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardScreen(
            client: client,
            activityId: 'outfit-test',
            contracts: client.contract,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('kernel-complete-confirm_outfit')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('fashion-slot-blazer')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('겉옷').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('fashion-color-blazer')),
        '차콜',
      );
      await tester.enterText(
        find.byKey(const ValueKey('fashion-size-blazer')),
        'M',
      );
      await tester.tap(find.byKey(const Key('fashion-confirm-submit')));
      await tester.pumpAndSettle();
      final request = client.commands.single;
      expect(request['activityId'], 'outfit-test');
      expect(request['expectedRevision'], 2);
      expect(request['selections'], [
        {
          'importId': 'blazer',
          'slot': 'outerwear',
          'color': '차콜',
          'size': 'M',
          'ownership': 'unknown',
        },
      ]);
    },
  );

  testWidgets(
    'reviewed shopping captures create an approval-gated comparison plan',
    (tester) async {
      final client = FakeKernelClient();
      final intentStore = FakeShoppingIntentStore();
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(
            client: client,
            intentStore: FakeRecipeIntentStore(),
            diningIntentStore: FakeDiningIntentStore(),
            fashionIntentStore: FakeFashionIntentStore(),
            beautyIntentStore: FakeBeautyIntentStore(),
            travelIntentStore: FakeTravelIntentStore(),
            lifeTipIntentStore: FakeLifeTipIntentStore(),
            shoppingIntentStore: intentStore,
            shoppingImportOptions: const [
              ShoppingImportOption(
                importId: 'a',
                title: '패브릭 수납함',
                displayedPriceText: '12,900원',
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const Key('kernel-create-shopping')),
      );
      await tester.tap(find.byKey(const Key('kernel-create-shopping')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('shopping-purpose')),
        '수납함 고르기',
      );
      await tester.tap(find.byKey(const Key('shopping-import-a')));
      await tester.tap(find.byKey(const Key('shopping-create-submit')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests.single['importIds'], ['a']);
      expect(client.scenarioRequests.single['purpose'], '수납함 고르기');
      expect(intentStore.pending, isNull);
      expect(client.board['tasks'], isEmpty);
      expect(find.text('계획 제안'), findsOneWidget);
    },
  );

  testWidgets('reviewed life-tip image creates an approval-gated plan', (
    tester,
  ) async {
    final client = FakeKernelClient();
    final intentStore = FakeLifeTipIntentStore();
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
          diningIntentStore: FakeDiningIntentStore(),
          fashionIntentStore: FakeFashionIntentStore(),
          beautyIntentStore: FakeBeautyIntentStore(),
          travelIntentStore: FakeTravelIntentStore(),
          lifeTipIntentStore: intentStore,
          lifeTipImportOptions: const [
            LifeTipImportOption(importId: 'receipts', title: '영수증 정리 3단계'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('kernel-create-life-tip')));
    await tester.tap(find.byKey(const Key('kernel-create-life-tip')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('life-tip-import-receipts')));
    await tester.tap(find.byKey(const Key('life-tip-create-submit')));
    await tester.pumpAndSettle();
    expect(client.scenarioRequests.single['importId'], 'receipts');
    expect(client.scenarioRequests.single['confirmed'], true);
    expect(intentStore.pending, isNull);
    expect(client.board['tasks'], isEmpty);
    expect(find.text('계획 제안'), findsOneWidget);
  });

  testWidgets(
    'life-tip board sends selected source steps and explicit outcomes',
    (tester) async {
      final client = FakeKernelClient();
      client.contract = {
        'capabilities': [
          {'id': 'life_tip.confirm_actions', 'actor': 'user', 'effect': 'none'},
          {'id': 'life_tip.record_outcomes', 'actor': 'user', 'effect': 'none'},
        ],
      };
      client.board = {
        'id': 'tip-test',
        'title': '영수증 정리',
        'goal': {'description': '정리해 보기'},
        'revision': 2,
        'lifecycle': 'active',
        'nextActions': ['confirm_actions'],
        'tasks': [
          {
            'id': 'confirm_actions',
            'title': '실천할 단계 확인',
            'revision': 1,
            'capabilityId': 'life_tip.confirm_actions',
            'executionStatus': 'not_started',
            'readiness': {
              'status': 'ready',
              'inputs': {
                'importId': 'receipts',
                'title': '영수증 정리 3단계',
                'mentionId': 'mention-receipts',
                'candidates': [
                  {
                    'factIndex': 1,
                    'text': '영수증 모으기',
                    'evidenceIds': ['e1'],
                  },
                  {
                    'factIndex': 2,
                    'text': '영수증 나누기',
                    'evidenceIds': ['e2'],
                  },
                ],
              },
              'reasons': <Object?>[],
            },
          },
        ],
        'pendingChanges': <Object?>[],
        'pendingProposals': <Object?>[],
        'results': <Object?>[],
        'artifacts': <Object?>[],
        'reminders': <Object?>[],
      };
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardScreen(
            client: client,
            activityId: 'tip-test',
            contracts: client.contract,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const Key('kernel-complete-confirm_actions')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('life-tip-fact-2')));
      await tester.tap(find.byKey(const Key('life-tip-confirm-submit')));
      await tester.pumpAndSettle();
      expect(client.commands.single['factIndexes'], [1]);

      client.board['tasks'] = [
        {
          'id': 'record_outcomes',
          'title': '실행 결과 기록',
          'revision': 1,
          'capabilityId': 'life_tip.record_outcomes',
          'executionStatus': 'not_started',
          'readiness': {
            'status': 'ready',
            'inputs': {
              'plan': {
                'id': 'plan-tip',
                'revision': 1,
                'tipId': 'tip-source',
                'title': '영수증 정리 3단계',
                'actions': [
                  {
                    'id': 'action-1',
                    'factIndex': 1,
                    'text': '영수증 모으기',
                    'order': 1,
                  },
                  {
                    'id': 'action-2',
                    'factIndex': 2,
                    'text': '영수증 나누기',
                    'order': 2,
                  },
                ],
              },
            },
            'reasons': <Object?>[],
          },
        },
      ];
      client.board['nextActions'] = ['record_outcomes'];
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardScreen(
            client: client,
            activityId: 'tip-test',
            contracts: client.contract,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const Key('kernel-complete-record_outcomes')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('life-tip-outcome-action-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('했어요').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('life-tip-outcome-action-2')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('하지 않았어요').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('life-tip-outcome-submit')));
      await tester.pumpAndSettle();
      expect(client.commands.last['actions'], [
        {'actionId': 'action-1', 'status': 'done'},
        {'actionId': 'action-2', 'status': 'skipped'},
      ]);
    },
  );

  testWidgets('reviewed travel places create an approval-gated day plan', (
    tester,
  ) async {
    final client = FakeKernelClient();
    final intentStore = FakeTravelIntentStore();
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
          diningIntentStore: FakeDiningIntentStore(),
          fashionIntentStore: FakeFashionIntentStore(),
          beautyIntentStore: FakeBeautyIntentStore(),
          travelIntentStore: intentStore,
          travelImportOptions: const [
            TravelImportOption(
              importId: 'view',
              name: '바람언덕 전망대',
              searchArea: '제주',
            ),
            TravelImportOption(
              importId: 'coast',
              name: '푸른곶 해안길',
              searchArea: '제주',
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('kernel-create-travel')));
    await tester.tap(find.byKey(const Key('kernel-create-travel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-import-view')));
    await tester.tap(find.byKey(const ValueKey('travel-import-coast')));
    await tester.tap(find.byKey(const Key('travel-create-submit')));
    await tester.pumpAndSettle();
    expect(client.scenarioRequests, hasLength(1));
    final request = client.scenarioRequests.single;
    expect(request['confirmed'], true);
    expect(request['importIds'], ['view', 'coast']);
    expect(request['area'], '제주');
    expect(request['startAt'], isA<String>());
    expect(intentStore.pending, isNull);
    expect(client.board['tasks'], isEmpty);
    expect(find.text('계획 제안'), findsOneWidget);
  });

  testWidgets('travel board sends user-confirmed order and times', (
    tester,
  ) async {
    final client = FakeKernelClient();
    final startAt = DateTime(2026, 9, 28, 9).toUtc().toIso8601String();
    client.contract = {
      'capabilities': [
        {'id': 'travel.confirm_itinerary', 'actor': 'user', 'effect': 'none'},
      ],
    };
    client.board = {
      'id': 'trip-test',
      'title': '제주 하루 여행',
      'goal': {'description': '장소 순서 정하기'},
      'revision': 2,
      'lifecycle': 'active',
      'nextActions': ['confirm_itinerary'],
      'tasks': [
        {
          'id': 'confirm_itinerary',
          'title': '장소 순서와 시각 확인',
          'revision': 1,
          'capabilityId': 'travel.confirm_itinerary',
          'executionStatus': 'not_started',
          'readiness': {
            'status': 'ready',
            'inputs': {
              'area': '제주',
              'startAt': startAt,
              'candidates': [
                {
                  'importId': 'view',
                  'name': '바람언덕 전망대',
                  'searchArea': '제주',
                  'mentionId': 'mention-view',
                  'evidenceIds': ['e1'],
                },
                {
                  'importId': 'coast',
                  'name': '푸른곶 해안길',
                  'searchArea': '제주',
                  'mentionId': 'mention-coast',
                  'evidenceIds': ['e2'],
                },
              ],
            },
            'reasons': <Object?>[],
          },
        },
      ],
      'pendingChanges': <Object?>[],
      'pendingProposals': <Object?>[],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardScreen(
          client: client,
          activityId: 'trip-test',
          contracts: client.contract,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('kernel-complete-confirm_itinerary')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-stop-up-coast')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('travel-stop-time-coast')),
      '10:00',
    );
    await tester.enterText(
      find.byKey(const ValueKey('travel-stop-time-view')),
      '13:00',
    );
    await tester.tap(find.byKey(const Key('travel-confirm-submit')));
    await tester.pumpAndSettle();
    expect(client.commands.single['activityId'], 'trip-test');
    expect(client.commands.single['expectedRevision'], 2);
    final selections = (client.commands.single['selections'] as List)
        .cast<Map>();
    expect(selections.map((item) => item['importId']).toList(), [
      'coast',
      'view',
    ]);
  });

  testWidgets('travel board sends a status for every confirmed stop', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract = {
      'capabilities': [
        {
          'id': 'travel.record_stop_outcomes',
          'actor': 'user',
          'effect': 'none',
        },
      ],
    };
    client.board = {
      'id': 'trip-test',
      'title': '제주 하루 여행',
      'goal': {'description': '방문 결과 기록'},
      'revision': 3,
      'lifecycle': 'active',
      'nextActions': ['record_stop_outcomes'],
      'tasks': [
        {
          'id': 'record_stop_outcomes',
          'title': '장소별 방문 결과 기록',
          'revision': 1,
          'capabilityId': 'travel.record_stop_outcomes',
          'executionStatus': 'not_started',
          'readiness': {
            'status': 'ready',
            'inputs': {
              'itinerary': {
                'id': 'itinerary-a',
                'revision': 1,
                'area': '제주',
                'startAt': '2026-09-28T00:00:00Z',
                'stops': [
                  {
                    'id': 'coast-stop',
                    'placeId': 'coast-place',
                    'title': '푸른곶 해안길',
                    'plannedAt': '2026-09-28T01:00:00Z',
                  },
                  {
                    'id': 'view-stop',
                    'placeId': 'view-place',
                    'title': '바람언덕 전망대',
                    'plannedAt': '2026-09-28T04:00:00Z',
                  },
                ],
              },
            },
            'reasons': <Object?>[],
          },
        },
      ],
      'pendingChanges': <Object?>[],
      'pendingProposals': <Object?>[],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardScreen(
          client: client,
          activityId: 'trip-test',
          contracts: client.contract,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('kernel-complete-record_stop_outcomes')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-outcome-coast-stop')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('다녀왔어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('travel-outcome-view-stop')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('못 갔어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('travel-outcome-submit')));
    await tester.pumpAndSettle();
    expect(client.commands.single['stops'], [
      {'stopId': 'coast-stop', 'status': 'visited'},
      {'stopId': 'view-stop', 'status': 'skipped'},
    ]);
  });

  testWidgets('reviewed beauty captures create an approval-gated routine', (
    tester,
  ) async {
    final client = FakeKernelClient();
    final intentStore = FakeBeautyIntentStore();
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
          diningIntentStore: FakeDiningIntentStore(),
          fashionIntentStore: FakeFashionIntentStore(),
          beautyIntentStore: intentStore,
          beautyImportOptions: const [
            BeautyImportOption(importId: 'cleanser', title: '데일리 클렌징 젤'),
            BeautyImportOption(importId: 'cream', title: '수분 장벽 크림'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('kernel-create-beauty')));
    await tester.tap(find.byKey(const Key('kernel-create-beauty')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('beauty-import-cleanser')));
    await tester.tap(find.byKey(const ValueKey('beauty-import-cream')));
    await tester.enterText(
      find.widgetWithText(TextField, '루틴 이름·상황'),
      '저녁 스킨케어',
    );
    await tester.tap(find.byKey(const Key('beauty-create-submit')));
    await tester.pumpAndSettle();
    expect(client.scenarioRequests, hasLength(1));
    final request = client.scenarioRequests.single;
    expect(request['confirmed'], true);
    expect(request['importIds'], ['cleanser', 'cream']);
    expect(request['occasion'], '저녁 스킨케어');
    expect(request['scheduledAt'], isA<String>());
    expect(intentStore.pending, isNull);
    expect(client.board['tasks'], isEmpty);
    expect(find.text('계획 제안'), findsOneWidget);
  });

  testWidgets('beauty confirmation preserves user-selected step order', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract = {
      'capabilities': [
        {'id': 'beauty.confirm_routine', 'actor': 'user', 'effect': 'none'},
      ],
    };
    client.board = {
      'id': 'beauty-test',
      'title': '저녁 루틴',
      'goal': {'description': '저녁 스킨케어'},
      'revision': 2,
      'lifecycle': 'active',
      'nextActions': ['confirm_routine'],
      'tasks': [
        {
          'id': 'confirm_routine',
          'title': '루틴 순서와 제품 옵션 확인',
          'revision': 1,
          'capabilityId': 'beauty.confirm_routine',
          'executionStatus': 'not_started',
          'readiness': {
            'status': 'ready',
            'inputs': {
              'candidates': [
                {
                  'importId': 'cream',
                  'name': '수분 장벽 크림',
                  'mentionId': 'mention-cream',
                  'evidenceIds': ['e1'],
                },
                {
                  'importId': 'cleanser',
                  'name': '데일리 클렌징 젤',
                  'mentionId': 'mention-cleanser',
                  'evidenceIds': ['e2'],
                },
              ],
            },
            'reasons': <Object?>[],
          },
        },
      ],
      'pendingChanges': <Object?>[],
      'pendingProposals': <Object?>[],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardScreen(
          client: client,
          activityId: 'beauty-test',
          contracts: client.contract,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('kernel-complete-confirm_routine')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('beauty-step-up-cleanser')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('beauty-confirm-include-cream')),
    );
    await tester.pumpAndSettle();
    expect(find.text('1. 데일리 클렌징 젤'), findsOneWidget);
    expect(find.text('수분 장벽 크림 · 제외'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('beauty-confirm-include-cream')),
    );
    await tester.pumpAndSettle();
    expect(find.text('2. 수분 장벽 크림'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('beauty-variant-cleanser')),
      '150 mL',
    );
    await tester.enterText(
      find.byKey(const ValueKey('beauty-step-title-cleanser')),
      '저녁 세안',
    );
    await tester.enterText(
      find.byKey(const ValueKey('beauty-variant-cream')),
      '50 mL',
    );
    await tester.enterText(
      find.byKey(const ValueKey('beauty-step-title-cream')),
      '저녁 보습',
    );
    await tester.tap(find.byKey(const Key('beauty-confirm-submit')));
    await tester.pumpAndSettle();
    expect(client.commands.single['activityId'], 'beauty-test');
    expect(client.commands.single['expectedRevision'], 2);
    expect(client.commands.single['selections'], [
      {'importId': 'cleanser', 'variantLabel': '150 mL', 'stepTitle': '저녁 세안'},
      {'importId': 'cream', 'variantLabel': '50 mL', 'stepTitle': '저녁 보습'},
    ]);
  });

  testWidgets('beauty outcome sends an explicit status for every step', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract = {
      'capabilities': [
        {
          'id': 'beauty.record_routine_outcome',
          'actor': 'user',
          'effect': 'none',
        },
      ],
    };
    client.board = {
      'id': 'beauty-test',
      'title': '저녁 루틴',
      'goal': {'description': '저녁 스킨케어'},
      'revision': 4,
      'lifecycle': 'active',
      'nextActions': ['record_routine_outcome'],
      'tasks': [
        {
          'id': 'record_routine_outcome',
          'title': '실제 사용 기록',
          'revision': 1,
          'capabilityId': 'beauty.record_routine_outcome',
          'executionStatus': 'not_started',
          'readiness': {
            'status': 'ready',
            'inputs': {
              'occurrence': {
                'id': 'occurrence-a',
                'templateId': 'template-a',
                'templateRevision': 1,
                'scheduledAt': '2026-09-27T12:00:00.000Z',
                'steps': [
                  {
                    'templateStepId': 'cleanse',
                    'title': '저녁 세안',
                    'variantId': 'variant-a',
                    'status': 'pending',
                  },
                  {
                    'templateStepId': 'moisturize',
                    'title': '저녁 보습',
                    'variantId': 'variant-b',
                    'status': 'pending',
                  },
                ],
              },
            },
            'reasons': <Object?>[],
          },
        },
      ],
      'pendingChanges': <Object?>[],
      'pendingProposals': <Object?>[],
      'results': <Object?>[],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardScreen(
          client: client,
          activityId: 'beauty-test',
          contracts: client.contract,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('kernel-complete-record_routine_outcome')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('beauty-outcome-submit')));
    await tester.pumpAndSettle();
    expect(client.commands, isEmpty);
    expect(find.text('모든 단계의 실제 사용 여부를 선택해 주세요.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('beauty-outcome-cleanse')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('사용했어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('beauty-outcome-moisturize')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('건너뛰었어요').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('beauty-outcome-submit')));
    await tester.pumpAndSettle();
    expect(client.commands.single['steps'], [
      {'templateStepId': 'cleanse', 'status': 'completed'},
      {'templateStepId': 'moisturize', 'status': 'skipped'},
    ]);
  });

  testWidgets('beauty board shows reported usage instead of creation status', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract = {
      'capabilities': [
        {
          'id': 'beauty.instantiate_routine',
          'actor': 'system',
          'effect': 'none',
        },
        {
          'id': 'beauty.record_routine_outcome',
          'actor': 'user',
          'effect': 'none',
        },
      ],
    };
    const occurrence = {
      'id': 'occurrence-a',
      'templateId': 'template-a',
      'templateRevision': 1,
      'scheduledAt': '2026-09-27T12:00:00.000Z',
      'steps': [
        {
          'templateStepId': 'cleanse',
          'title': '저녁 세안',
          'variantId': 'variant-a',
          'status': 'pending',
        },
        {
          'templateStepId': 'moisturize',
          'title': '저녁 보습',
          'variantId': 'variant-b',
          'status': 'pending',
        },
      ],
    };
    client.board = {
      'id': 'beauty-test',
      'title': '저녁 루틴',
      'goal': {'description': '저녁 스킨케어'},
      'revision': 5,
      'lifecycle': 'active',
      'nextActions': <Object?>[],
      'tasks': [
        {
          'id': 'instantiate_routine',
          'title': '루틴 회차 만들기',
          'revision': 2,
          'capabilityId': 'beauty.instantiate_routine',
          'executionStatus': 'completed',
          'readiness': {'status': 'ready', 'inputs': {}, 'reasons': []},
          'latestOutputRef': 'result-occurrence',
        },
        {
          'id': 'record_routine_outcome',
          'title': '실제 사용 기록',
          'revision': 2,
          'capabilityId': 'beauty.record_routine_outcome',
          'executionStatus': 'completed',
          'readiness': {
            'status': 'ready',
            'inputs': {'occurrence': occurrence},
            'reasons': [],
          },
          'latestOutputRef': 'result-outcome',
        },
      ],
      'pendingChanges': <Object?>[],
      'pendingProposals': <Object?>[],
      'results': [
        {'id': 'result-occurrence', 'value': occurrence},
        {
          'id': 'result-outcome',
          'value': {
            'occurrenceId': 'occurrence-a',
            'steps': [
              {'templateStepId': 'cleanse', 'status': 'completed'},
              {'templateStepId': 'moisturize', 'status': 'skipped'},
            ],
          },
        },
      ],
      'artifacts': <Object?>[],
      'reminders': <Object?>[],
    };
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardScreen(
          client: client,
          activityId: 'beauty-test',
          contracts: client.contract,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('• 저녁 세안 · 사용했어요'), findsOneWidget);
    expect(find.text('• 저녁 보습 · 건너뛰었어요'), findsOneWidget);
    expect(find.textContaining('사용 대기'), findsNothing);
    expect(find.textContaining('미기록'), findsNothing);
  });

  testWidgets('a synced capture links only after manual recipe review', (
    tester,
  ) async {
    final client = FakeKernelClient();
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: client,
          intentStore: FakeRecipeIntentStore(),
          importOptions: const [
            RecipeImportOption(
              importId: 'reviewed-capture-1',
              title: '저장한 요리 자료',
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-create-reviewed-recipe')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const Key('kernel-reviewed-recipe-title')),
          )
          .controller!
          .text,
      isEmpty,
    );
    expect(client.scenarioRequests, isEmpty);
    await tester.enterText(
      find.byKey(const Key('kernel-reviewed-recipe-title')),
      '두부국',
    );
    await tester.enterText(
      find.byKey(const Key('kernel-reviewed-base-servings')),
      '2',
    );
    await tester.enterText(
      find.byKey(const Key('kernel-reviewed-target-servings')),
      '4',
    );
    await tester.enterText(
      find.byKey(const Key('kernel-reviewed-ingredient-name-0')),
      '두부',
    );
    await tester.enterText(
      find.byKey(const Key('kernel-reviewed-ingredient-amount-0')),
      '300',
    );
    await tester.tap(find.byKey(const Key('kernel-reviewed-preview')));
    await tester.pumpAndSettle();
    expect(find.text('연결할 자료: 저장한 요리 자료'), findsOneWidget);
    expect(find.text('• 두부 300 g'), findsOneWidget);
    expect(client.scenarioRequests, isEmpty);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('kernel-reviewed-submit')))
          .onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const Key('kernel-reviewed-recipe-confirm')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-reviewed-submit')));
    await tester.pumpAndSettle();
    final request = client.scenarioRequests.single;
    expect(request['importId'], 'reviewed-capture-1');
    expect(request.containsKey('synthetic'), isFalse);
    expect(request['targetServings'], 4);
    expect((request['recipe'] as Map)['title'], '두부국');
    final ingredient =
        ((request['recipe'] as Map)['ingredients'] as List).single as Map;
    expect(ingredient['quantity'], {
      'status': 'known',
      'amount': 300,
      'unit': 'g',
    });
  });

  testWidgets(
    'timed out recipe creation reuses its durable intent after restart',
    (tester) async {
      final client = FakeKernelClient()..commitThenTimeout = true;
      final intentStore = FakeRecipeIntentStore();
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(client: client, intentStore: intentStore),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-create-sample-recipe')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const Key('kernel-sample-recipe-acknowledge')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('kernel-confirm-sample-recipe')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests, hasLength(1));
      expect(intentStore.pending, isNotNull);
      expect(
        find.byKey(const Key('kernel-retry-recipe-create')),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
      client.commitThenTimeout = false;
      await tester.pumpWidget(
        MaterialApp(
          home: CommonBoardsScreen(client: client, intentStore: intentStore),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('kernel-create-sample-recipe')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('kernel-retry-recipe-create')));
      await tester.pumpAndSettle();
      expect(client.scenarioRequests, hasLength(2));
      expect(
        jsonEncode(client.scenarioRequests[0]),
        jsonEncode(client.scenarioRequests[1]),
      );
      expect(intentStore.pending, isNull);
      expect(find.byType(CommonBoardScreen), findsOneWidget);
    },
  );

  testWidgets('definitive import rejection clears the saved creation request', (
    tester,
  ) async {
    final client = FakeKernelClient()
      ..scenarioFailure = const CommonKernelException(
        'IMPORT_NOT_FOUND',
        '연결할 확인 자료를 찾을 수 없어요.',
        statusCode: 404,
      );
    final intentStore = FakeRecipeIntentStore();
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(client: client, intentStore: intentStore),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-create-sample-recipe')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-sample-recipe-acknowledge')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('kernel-confirm-sample-recipe')));
    await tester.pumpAndSettle();
    expect(intentStore.pending, isNull);
    expect(find.byKey(const Key('kernel-retry-recipe-create')), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('kernel-create-sample-recipe')),
          )
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('corrupt saved intent can be explicitly discarded', (
    tester,
  ) async {
    final intentStore = FakeRecipeIntentStore()..corrupt = true;
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: CommonBoardsScreen(
          client: FakeKernelClient(),
          intentStore: intentStore,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('kernel-create-sample-recipe')),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(
      find.byKey(const Key('kernel-discard-corrupt-recipe-intent')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('요청 지우기'));
    await tester.pumpAndSettle();
    expect(intentStore.corrupt, isFalse);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const Key('kernel-create-sample-recipe')),
          )
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('changed evidence disables stale proposal approval', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.board['tasks'] = <Object?>[];
    client.board['pendingProposals'] = [
      {
        'id': 'proposal-stale',
        'kind': 'draft',
        'plan': {
          'tasks': [
            {'id': 'cook', 'title': '요리하기', 'capabilityId': 'recipe.cook'},
          ],
        },
      },
    ];
    await _pump(tester, client);
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('kernel-approve-proposal-proposal-stale')),
    );
    expect(button.onPressed, isNull);
    expect(client.acceptedProposals, isEmpty);
    expect(find.textContaining('새 계획을 만든 뒤 승인해 주세요'), findsOneWidget);
  });

  testWidgets('keeping a reviewed result requires explicit confirmation', (
    tester,
  ) async {
    final client = FakeKernelClient();
    (client.board['tasks'] as List)[0]['readiness'] = {
      'status': 'needs_review',
      'inputs': {},
      'reasons': ['근거 변경'],
    };
    await _pump(tester, client);
    await tester.tap(find.byKey(const Key('kernel-review-task-Z')));
    await tester.pumpAndSettle();
    expect(client.commands, isEmpty);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(client.commands, isEmpty);
    await tester.tap(find.byKey(const Key('kernel-review-task-Z')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('이전 결과 유지').last);
    await tester.pumpAndSettle();
    expect(client.commands.single['type'], 'task.resolveReview');
    expect(client.commands.single['payload'], {
      'taskId': 'task-Z',
      'expectedTaskRevision': 2,
      'resolution': 'keep_consumed',
    });
  });

  testWidgets('recipe inventory uses typed known and unknown quantities', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = [
      {
        'id': 'recipe.check_inventory',
        'actor': 'user',
        'effect': 'none',
        'outputType': 'recipe.inventory',
      },
    ];
    client.board['pendingChanges'] = <Object?>[];
    client.board['tasks'] = [
      {
        'id': 'inventory',
        'title': '재고 확인',
        'revision': 1,
        'capabilityId': 'recipe.check_inventory',
        'executionStatus': 'not_started',
        'inputBindings': {
          'ingredientIds': ['egg', 'tomato'],
        },
        'readiness': {
          'status': 'ready',
          'inputs': {
            'ingredientIds': ['egg', 'tomato'],
          },
          'reasons': <Object?>[],
        },
      },
      {
        'id': 'scale',
        'title': '인분 계산',
        'revision': 1,
        'capabilityId': 'recipe.scale_servings',
        'executionStatus': 'not_started',
        'inputBindings': {
          'recipe': {
            'title': '샘플 레시피',
            'baseServings': 2,
            'ingredients': [
              {
                'ingredientId': 'egg',
                'name': '달걀',
                'quantity': {'status': 'known', 'amount': 2, 'unit': 'count'},
              },
              {
                'ingredientId': 'tomato',
                'name': '토마토',
                'quantity': {'status': 'known', 'amount': 200, 'unit': 'g'},
              },
            ],
          },
          'targetServings': 4,
        },
        'readiness': {
          'status': 'blocked',
          'inputs': {},
          'reasons': <Object?>[],
        },
      },
    ];
    await _pump(tester, client);
    expect(find.text('보유 수량을 확인할 재료'), findsOneWidget);
    expect(find.text('• 달걀'), findsOneWidget);
    await tester.tap(find.byKey(const Key('kernel-complete-inventory')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('kernel-inventory-amount-0')),
      '2',
    );
    await tester.tap(find.byKey(const Key('kernel-confirm-inventory')));
    await tester.pumpAndSettle();
    final output = (client.commands.single['payload'] as Map)['output'] as List;
    expect(output[0]['ingredientId'], 'egg');
    expect(output[0]['quantity'], {
      'status': 'known',
      'amount': 2,
      'unit': 'count',
    });
    expect(output[1]['quantity'], {'status': 'unknown'});
    expect(output[0]['observedAt'], endsWith('Z'));
  });

  testWidgets('recipe cooking records confirmed completion without JSON', (
    tester,
  ) async {
    final client = FakeKernelClient();
    client.contract['capabilities'] = [
      {
        'id': 'recipe.cook',
        'actor': 'user',
        'effect': 'none',
        'outputType': 'recipe.cook_result',
      },
    ];
    client.board['pendingChanges'] = <Object?>[];
    client.board['tasks'] = [
      {
        'id': 'cook',
        'title': '요리하기',
        'revision': 2,
        'capabilityId': 'recipe.cook',
        'executionStatus': 'not_started',
        'inputBindings': {
          'recipeId': 'recipe-1',
          'recipeRevision': 1,
          'targetServings': 4,
        },
        'readiness': {
          'status': 'ready',
          'inputs': {
            'recipeId': 'recipe-1',
            'recipeRevision': 1,
            'targetServings': 4,
          },
          'reasons': <Object?>[],
        },
      },
    ];
    await _pump(tester, client);
    await tester.tap(find.byKey(const Key('kernel-complete-cook')));
    await tester.pumpAndSettle();
    expect(find.textContaining('재고는 자동으로 차감되지 않아요'), findsWidgets);
    expect(client.commands, isEmpty);
    await tester.enterText(find.byKey(const Key('kernel-cook-reporter')), '나');
    await tester.tap(find.byKey(const Key('kernel-confirm-cook')));
    await tester.pumpAndSettle();
    final output = (client.commands.single['payload'] as Map)['output'] as Map;
    expect(output['recipeId'], 'recipe-1');
    expect(output['reportedBy'], '나');
    expect(output['completedAt'], endsWith('Z'));
  });

  testWidgets(
    'recipe shopping list uses readable quantities and unknown status',
    (tester) async {
      final client = FakeKernelClient();
      client.contract['capabilities'] = [
        {
          'id': 'recipe.calculate_requirements',
          'actor': 'system',
          'effect': 'none',
        },
      ];
      client.board['pendingChanges'] = <Object?>[];
      client.board['tasks'] = [
        {
          'id': 'shopping',
          'title': '부족한 재료 계산',
          'revision': 2,
          'capabilityId': 'recipe.calculate_requirements',
          'executionStatus': 'completed',
          'latestOutputRef': 'result-1',
          'readiness': {
            'status': 'ready',
            'inputs': {},
            'reasons': <Object?>[],
          },
        },
      ];
      client.board['results'] = [
        {
          'id': 'result-1',
          'value': {
            'items': [
              {
                'name': '달걀',
                'status': 'needed',
                'requiredQuantity': {
                  'status': 'known',
                  'amount': 4,
                  'unit': 'count',
                },
                'availableQuantity': {
                  'status': 'known',
                  'amount': 2,
                  'unit': 'count',
                },
                'missingQuantity': {
                  'status': 'known',
                  'amount': 2,
                  'unit': 'count',
                },
              },
              {
                'name': '토마토',
                'status': 'unknown',
                'requiredQuantity': {
                  'status': 'known',
                  'amount': 400,
                  'unit': 'g',
                },
                'availableQuantity': {'status': 'unknown'},
                'missingQuantity': {'status': 'unknown'},
              },
            ],
          },
        },
      ];
      await _pump(tester, client);
      expect(find.textContaining('달걀: 추가로 필요'), findsOneWidget);
      expect(find.textContaining('토마토: 재고 확인 필요'), findsOneWidget);
      expect(find.textContaining('부족 2 count'), findsOneWidget);
    },
  );
}
