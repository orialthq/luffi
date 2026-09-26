import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/common_kernel_client.dart';

final class RecipeCorrectionScreen extends StatefulWidget {
  const RecipeCorrectionScreen({
    required this.client,
    required this.activityId,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;

  @override
  State<RecipeCorrectionScreen> createState() => _RecipeCorrectionScreenState();
}

final class _IngredientEdit {
  _IngredientEdit(KernelJson item)
    : id = item['id'] as String,
      ingredientId = item['ingredientId'] as String,
      originalName = item['name'] as String,
      name = TextEditingController(text: item['name'] as String),
      amount = TextEditingController(
        text: ((item['quantity'] as Map?)?['amount'] ?? '').toString(),
      ),
      status = ((item['quantity'] as Map?)?['status'] ?? 'known') as String,
      unit = ((item['quantity'] as Map?)?['unit'] ?? 'g') as String,
      scaling = (item['scaling'] ?? 'linear') as String,
      optional = item['optional'] == true;

  final String id;
  final String ingredientId;
  final String originalName;
  final TextEditingController name;
  final TextEditingController amount;
  String status;
  String unit;
  String scaling;
  bool optional;

  void dispose() {
    name.dispose();
    amount.dispose();
  }
}

final class _StepEdit {
  _StepEdit(KernelJson item)
    : id = item['id'] as String,
      instruction = TextEditingController(text: item['instruction'] as String);
  final String id;
  final TextEditingController instruction;
  void dispose() => instruction.dispose();
}

final class _RecipeCorrectionScreenState extends State<RecipeCorrectionScreen> {
  static const _units = ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp'];
  final _title = TextEditingController();
  final _servings = TextEditingController();
  final _allIngredients = <_IngredientEdit>[];
  final _allSteps = <_StepEdit>[];
  final _ingredients = <_IngredientEdit>[];
  final _steps = <_StepEdit>[];
  KernelJson? _data;
  KernelJson? _pending;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _title.dispose();
    _servings.dispose();
    for (final item in _allIngredients) {
      item.dispose();
    }
    for (final item in _allSteps) {
      item.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.client.getEditableRecipe(widget.activityId);
      if (!mounted) return;
      final recipe = Map<String, Object?>.from(data['recipe'] as Map);
      _title.text = recipe['title'] as String;
      _servings.text = '${recipe['baseServings']}';
      _ingredients.clear();
      _steps.clear();
      for (final raw in recipe['ingredients'] as List) {
        final item = _IngredientEdit(Map<String, Object?>.from(raw as Map));
        _allIngredients.add(item);
        _ingredients.add(item);
      }
      for (final raw in (recipe['steps'] as List? ?? const [])) {
        final item = _StepEdit(Map<String, Object?>.from(raw as Map));
        _allSteps.add(item);
        _steps.add(item);
      }
      setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _addIngredient() {
    if (_ingredients.length >= 25) return;
    final id = newKernelCommandId();
    final item = _IngredientEdit({
      'id': 'line-$id',
      'ingredientId': 'ingredient-$id',
      'name': '',
      'quantity': {'status': 'known', 'amount': 1, 'unit': 'g'},
      'scaling': 'linear',
    });
    item.amount.clear();
    _allIngredients.add(item);
    setState(() => _ingredients.add(item));
  }

  void _addStep() {
    if (_steps.length >= 30) return;
    final item = _StepEdit({
      'id': 'step-${newKernelCommandId()}',
      'instruction': '',
    });
    _allSteps.add(item);
    setState(() => _steps.add(item));
  }

  KernelJson? _buildRecipe() {
    final title = _title.text.trim();
    final servings = int.tryParse(_servings.text.trim());
    if (title.isEmpty ||
        title.length > 200 ||
        servings == null ||
        servings < 1 ||
        servings > 50 ||
        _ingredients.isEmpty) {
      setState(() => _error = '레시피 이름, 1~50인분, 재료를 확인해 주세요.');
      return null;
    }
    final ingredients = <KernelJson>[];
    for (final item in _ingredients) {
      final name = item.name.text.trim();
      if (name.isEmpty || name.length > 100) {
        setState(() => _error = '모든 재료 이름을 100자 이하로 입력해 주세요.');
        return null;
      }
      KernelJson quantity = {'status': item.status};
      if (item.status == 'known') {
        final amount = num.tryParse(item.amount.text.trim());
        if (amount == null || !amount.isFinite || amount <= 0 || amount > 1e9) {
          setState(() => _error = '확인한 재료의 수량을 0 초과 10억 이하로 입력해 주세요.');
          return null;
        }
        quantity = {'status': 'known', 'amount': amount, 'unit': item.unit};
      }
      ingredients.add({
        'id': item.id,
        // Renaming a line to another ingredient must not silently retain its
        // previous identity or inventory association.
        'ingredientId': name == item.originalName
            ? item.ingredientId
            : 'ingredient-${newKernelCommandId()}',
        'name': name, 'quantity': quantity, 'scaling': item.scaling,
        'optional': item.optional,
      });
    }
    final steps = <KernelJson>[];
    for (final item in _steps) {
      final instruction = item.instruction.text.trim();
      if (instruction.isEmpty || instruction.length > 1000) {
        setState(() => _error = '모든 조리 단계를 1000자 이하로 입력해 주세요.');
        return null;
      }
      steps.add({'id': item.id, 'instruction': instruction});
    }
    return {
      'title': title,
      'baseServings': servings,
      'ingredients': ingredients,
      'steps': steps,
    };
  }

  Future<void> _confirm() async {
    if (_busy || _pending != null || _data == null) return;
    final recipe = _buildRecipe();
    if (recipe == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('레시피 정정 확인'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${recipe['title']} · 기준 ${recipe['baseServings']}인분'),
              for (final item in recipe['ingredients'] as List)
                Text(
                  '• ${(item as Map)['name']} · ${_quantity(item['quantity'])}',
                ),
              const SizedBox(height: 8),
              for (final entry in (recipe['steps'] as List).asMap().entries)
                Text(
                  '${entry.key + 1}. ${(entry.value as Map)['instruction']}',
                ),
              const SizedBox(height: 8),
              const Text('재료 관계와 조리 순서를 함께 바꿉니다. 기존에 완료한 작업은 그대로 보존돼요.'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('정정 반영'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    _pending = {
      'commandId': newKernelCommandId(),
      'activityId': widget.activityId,
      'expectedAssertionId': _data!['assertionId'],
      'recipe': recipe,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pending;
    if (request == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.correctRecipe(request);
      _pending = null;
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      final retryable =
          error is CommonKernelException &&
          (['NETWORK_TIMEOUT', 'NETWORK_UNAVAILABLE'].contains(error.code) ||
              error.statusCode == 429 ||
              (error.statusCode != null && error.statusCode! >= 500));
      if (!retryable) _pending = null;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _move<T>(List<T> items, int index, int direction) {
    final other = index + direction;
    if (other < 0 || other >= items.length) return;
    setState(() {
      final item = items.removeAt(index);
      items.insert(other, item);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('레시피 정정')),
    body: _data == null && _busy
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_busy) const LinearProgressIndicator(),
              if (_error != null) ...[
                Text('정정을 확인하지 못했어요: $_error'),
                TextButton(
                  onPressed: _busy
                      ? null
                      : _pending == null
                      ? _load
                      : _submit,
                  child: Text(_pending == null ? '새로고침' : '같은 요청 다시 보내기'),
                ),
              ],
              if (_data != null) ...[
                const Text('처음 확인한 레시피는 보존하고, 아래의 현재 값을 정정해요.'),
                if (_data!['originalRecipe'] is Map)
                  ExpansionTile(
                    title: const Text('처음 확인한 재료·순서 보기'),
                    children: [
                      Text('${(_data!['originalRecipe'] as Map)['title']}'),
                      for (final item
                          in ((_data!['originalRecipe'] as Map)['ingredients']
                                  as List? ??
                              const []))
                        Text(
                          '• ${(item as Map)['name']} · ${_quantity(item['quantity'])}',
                        ),
                      for (final step
                          in ((_data!['originalRecipe'] as Map)['steps']
                                  as List? ??
                              const []))
                        Text(
                          '${(step as Map)['order']}. ${step['instruction']}',
                        ),
                    ],
                  ),
                TextField(
                  controller: _title,
                  maxLength: 200,
                  decoration: const InputDecoration(labelText: '레시피 이름'),
                ),
                TextField(
                  controller: _servings,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: '기준 인분'),
                ),
                const SizedBox(height: 14),
                Text(
                  '재료와 기준 분량',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const Text('이름을 다른 재료로 바꾸면 재고 연결도 새 재료로 취급해요.'),
                for (final entry in _ingredients.asMap().entries)
                  _ingredientCard(entry.key, entry.value),
                TextButton.icon(
                  onPressed: _busy ? null : _addIngredient,
                  icon: const Icon(Icons.add),
                  label: const Text('재료 추가'),
                ),
                const SizedBox(height: 14),
                Text('조리 순서', style: Theme.of(context).textTheme.titleMedium),
                for (final entry in _steps.asMap().entries)
                  _stepCard(entry.key, entry.value),
                TextButton.icon(
                  onPressed: _busy ? null : _addStep,
                  icon: const Icon(Icons.add),
                  label: const Text('조리 단계 추가'),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  key: const Key('submit-recipe-correction'),
                  onPressed: _busy || _pending != null ? null : _confirm,
                  child: const Text('변경 내용 검토'),
                ),
              ],
            ],
          ),
  );

  Widget _ingredientCard(int index, _IngredientEdit item) => Card(
    key: ValueKey('recipe-ingredient-${item.id}'),
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(child: Text('${index + 1}. 재료')),
              IconButton(
                key: Key('recipe-ingredient-up-$index'),
                tooltip: '위로',
                onPressed: index == 0
                    ? null
                    : () => _move(_ingredients, index, -1),
                icon: const Icon(Icons.arrow_upward),
              ),
              IconButton(
                tooltip: '아래로',
                onPressed: index == _ingredients.length - 1
                    ? null
                    : () => _move(_ingredients, index, 1),
                icon: const Icon(Icons.arrow_downward),
              ),
              IconButton(
                tooltip: '재료 삭제',
                onPressed: _ingredients.length == 1
                    ? null
                    : () => setState(() => _ingredients.remove(item)),
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
          TextField(
            key: Key('recipe-ingredient-name-$index'),
            controller: item.name,
            maxLength: 100,
            decoration: const InputDecoration(labelText: '재료 이름'),
          ),
          DropdownButtonFormField<String>(
            initialValue: item.status,
            decoration: const InputDecoration(labelText: '분량 상태'),
            items: const [
              DropdownMenuItem(value: 'known', child: Text('수량 확인')),
              DropdownMenuItem(value: 'unknown', child: Text('수량 모름')),
              DropdownMenuItem(value: 'as_needed', child: Text('적당량')),
            ],
            onChanged: (value) {
              if (value != null) setState(() => item.status = value);
            },
          ),
          if (item.status == 'known')
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: Key('recipe-ingredient-amount-$index'),
                    controller: item.amount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: '기준 수량'),
                  ),
                ),
                const SizedBox(width: 12),
                DropdownButton<String>(
                  value: item.unit,
                  items: [
                    for (final unit in _units)
                      DropdownMenuItem(value: unit, child: Text(unit)),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => item.unit = value);
                  },
                ),
              ],
            ),
          Row(
            children: [
              const Text('인분에 따라 늘림'),
              Switch(
                value: item.scaling == 'linear',
                onChanged: (value) =>
                    setState(() => item.scaling = value ? 'linear' : 'fixed'),
              ),
              const Spacer(),
              const Text('선택 재료'),
              Checkbox(
                value: item.optional,
                onChanged: (value) =>
                    setState(() => item.optional = value == true),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _stepCard(int index, _StepEdit item) => Card(
    key: ValueKey('recipe-step-${item.id}'),
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Text('${index + 1}.'),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              key: Key('recipe-step-input-$index'),
              controller: item.instruction,
              maxLength: 1000,
              maxLines: 2,
              decoration: const InputDecoration(labelText: '조리 내용'),
            ),
          ),
          Column(
            children: [
              IconButton(
                key: Key('recipe-step-up-$index'),
                tooltip: '위로',
                onPressed: index == 0 ? null : () => _move(_steps, index, -1),
                icon: const Icon(Icons.arrow_upward),
              ),
              IconButton(
                tooltip: '아래로',
                onPressed: index == _steps.length - 1
                    ? null
                    : () => _move(_steps, index, 1),
                icon: const Icon(Icons.arrow_downward),
              ),
              IconButton(
                tooltip: '단계 삭제',
                onPressed: () => setState(() => _steps.remove(item)),
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}

String _quantity(Object? raw) {
  final quantity = raw is Map ? raw : const {};
  if (quantity['status'] == 'unknown') return '수량 모름';
  if (quantity['status'] == 'as_needed') return '적당량';
  return '${quantity['amount']} ${quantity['unit']}';
}
