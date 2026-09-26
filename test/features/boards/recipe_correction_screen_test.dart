import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ori_beauty/data/common_kernel_client.dart';
import 'package:ori_beauty/features/boards/recipe_correction_screen.dart';

final class _Client implements CommonKernelClient {
  final requests = <KernelJson>[];
  bool timeoutOnce = true;

  @override
  Future<KernelJson> getEditableRecipe(String activityId) async => {
    'activityId': activityId,
    'assertionId': 'assertion-1',
    'originalRecipe': {'title': '토마토 달걀 볶음'},
    'recipe': {
      'id': 'recipe-1',
      'revision': 1,
      'title': '토마토 달걀 볶음',
      'baseServings': 2,
      'ingredients': [
        {
          'id': 'egg',
          'ingredientId': 'egg',
          'name': '달걀',
          'quantity': {'status': 'known', 'amount': 2, 'unit': 'count'},
          'scaling': 'linear',
        },
        {
          'id': 'tomato',
          'ingredientId': 'tomato',
          'name': '토마토',
          'quantity': {'status': 'known', 'amount': 200, 'unit': 'g'},
          'scaling': 'linear',
        },
      ],
      'steps': [
        {'id': 'slice', 'order': 1, 'instruction': '토마토를 썬다.'},
        {'id': 'fry', 'order': 2, 'instruction': '달걀을 볶는다.'},
      ],
    },
  };

  @override
  Future<KernelJson> correctRecipe(KernelJson request) async {
    requests.add(Map<String, Object?>.from(request));
    if (timeoutOnce) {
      timeoutOnce = false;
      throw const CommonKernelException('NETWORK_TIMEOUT', '응답 시간이 지났어요');
    }
    return {'activityId': request['activityId'], 'replayed': true};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'edits quantity and order, then retries one confirmed graph correction',
    (tester) async {
      final client = _Client();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: FilledButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => RecipeCorrectionScreen(
                        client: client,
                        activityId: 'cook',
                      ),
                    ),
                  ),
                  child: const Text('열기'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('열기'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('recipe-ingredient-amount-0')),
        '3',
      );
      await tester.scrollUntilVisible(
        find.byKey(const Key('recipe-ingredient-up-1')),
        300,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.byKey(const Key('recipe-ingredient-up-1')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('recipe-step-up-1')),
        300,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.byKey(const Key('recipe-step-up-1')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('submit-recipe-correction')),
        300,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.byKey(const Key('submit-recipe-correction')));
      await tester.pumpAndSettle();
      expect(find.text('레시피 정정 확인'), findsOneWidget);
      await tester.tap(find.text('정정 반영'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(1));
      final recipe = client.requests.single['recipe'] as Map;
      final ingredients = recipe['ingredients'] as List;
      final steps = recipe['steps'] as List;
      expect((ingredients[0] as Map)['id'], 'tomato');
      expect(((ingredients[1] as Map)['quantity'] as Map)['amount'], 3);
      expect((steps[0] as Map)['id'], 'fry');
      await tester.scrollUntilVisible(
        find.text('같은 요청 다시 보내기'),
        -300,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.text('같은 요청 다시 보내기'), findsOneWidget);
      await tester.tap(find.text('같은 요청 다시 보내기'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(2));
      expect(client.requests[1], client.requests[0]);
      expect(find.text('열기'), findsOneWidget);
    },
  );
}
