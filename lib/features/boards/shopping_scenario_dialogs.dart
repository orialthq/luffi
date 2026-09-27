import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';
import '../../domain/models.dart';

final class ShoppingPriceFact {
  const ShoppingPriceFact({
    required this.sourcePath,
    required this.label,
    required this.value,
    required this.selectable,
  });
  final String sourcePath;
  final String label;
  final String value;
  final bool selectable;
}

final class ShoppingImportOption {
  const ShoppingImportOption({
    required this.importId,
    required this.title,
    this.displayedPriceText,
    this.priceFacts = const [],
  });
  final String importId;
  final String title;
  final String? displayedPriceText;
  final List<ShoppingPriceFact> priceFacts;
}

ShoppingImportOption? shoppingImportOptionForAnalysis(
  String importId,
  StructuredContentAnalysis analysis,
) {
  if (analysis.contentKind != ContentKind.commerceProduct ||
      analysis.completeness != StructuredCompleteness.complete ||
      analysis.title.status != ObservedStatus.observed ||
      analysis.title.value?.trim().isNotEmpty != true ||
      analysis.title.evidenceIds.isEmpty ||
      analysis.place?.name != null ||
      analysis.facts.length > 9 ||
      analysis.facts.any(
        (fact) =>
            fact.label.trim().isEmpty ||
            fact.value.trim().isEmpty ||
            fact.evidenceIds.isEmpty,
      )) {
    return null;
  }
  final pricePattern = RegExp(r'^\d{1,3}(,\d{3})*원$');
  final visibleLabel = RegExp(r'가격|현재가|표시가|판매가|할인가|정가|원가');
  final currentLabel = RegExp(r'^(가격|현재(\s*표시)?가|화면\s*표시가|판매가|할인가)$');
  final prices = [
    for (final entry in analysis.facts.asMap().entries)
      if (visibleLabel.hasMatch(entry.value.label) &&
          pricePattern.hasMatch(entry.value.value.trim()))
        ShoppingPriceFact(
          sourcePath: '/facts/${entry.key}/value',
          label: entry.value.label,
          value: entry.value.value.trim(),
          selectable: currentLabel.hasMatch(entry.value.label.trim()),
        ),
  ];
  if (prices.isEmpty || !prices.any((price) => price.selectable)) return null;
  return ShoppingImportOption(
    importId: importId,
    title: analysis.title.value!.trim(),
    displayedPriceText: prices.length == 1 && prices.single.label == '가격'
        ? prices.single.value
        : null,
    priceFacts: prices.length > 1 || prices.single.label != '가격'
        ? prices
        : const [],
  );
}

String _text(Object? value) => value is String ? value : '';

final class ShoppingScenarioDialog extends StatefulWidget {
  const ShoppingScenarioDialog({required this.options, super.key});
  final List<ShoppingImportOption> options;
  @override
  State<ShoppingScenarioDialog> createState() => _ShoppingScenarioDialogState();
}

final class _ShoppingScenarioDialogState extends State<ShoppingScenarioDialog> {
  final _purpose = TextEditingController();
  final _selected = <String>{};
  final _selectedPricePaths = <String, String>{};
  String? _error;

  @override
  void dispose() {
    _purpose.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('저장한 상품 비교하기'),
    content: SizedBox(
      width: 460,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '상품 캡처를 1~8개 고르세요. 가격은 캡처 당시 표시값이며 현재 가격이나 구매 사실이 아닙니다.',
            ),
            TextField(
              key: const Key('shopping-purpose'),
              controller: _purpose,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: '쇼핑 목적',
                hintText: '예: 옷장 수납함 고르기',
              ),
            ),
            for (final option in widget.options) ...[
              CheckboxListTile(
                key: ValueKey('shopping-import-${option.importId}'),
                value: _selected.contains(option.importId),
                title: Text(option.title),
                subtitle: Text(
                  option.priceFacts.isEmpty
                      ? '캡처 표시 ${option.displayedPriceText}'
                      : '가격 문구 확인 필요',
                ),
                onChanged: (checked) => setState(() {
                  if (checked == true) {
                    _selected.add(option.importId);
                  } else {
                    _selected.remove(option.importId);
                  }
                }),
              ),
              if (_selected.contains(option.importId) &&
                  option.priceFacts.isNotEmpty)
                for (final price in option.priceFacts)
                  ListTile(
                    key: ValueKey(
                      'shopping-price-${option.importId}-${price.sourcePath}',
                    ),
                    leading: Icon(
                      _selectedPricePaths[option.importId] == price.sourcePath
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                    ),
                    title: Text('${price.label} ${price.value}'),
                    subtitle: price.selectable
                        ? const Text('캡처 당시 표시 가격으로 확인')
                        : const Text('이전 가격 등: 현재 표시 가격으로 선택할 수 없음'),
                    onTap: price.selectable
                        ? () => setState(() {
                            _selectedPricePaths[option.importId] =
                                price.sourcePath;
                          })
                        : null,
                  ),
            ],
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
        key: const Key('shopping-create-submit'),
        onPressed: () {
          if (_purpose.text.trim().isEmpty ||
              _selected.isEmpty ||
              _selected.length > 8) {
            setState(() => _error = '목적과 상품 1~8개를 확인해 주세요.');
            return;
          }
          final selectedOptions = widget.options
              .where((item) => _selected.contains(item.importId))
              .toList();
          if (selectedOptions.any(
            (item) =>
                item.priceFacts.isNotEmpty &&
                !_selectedPricePaths.containsKey(item.importId),
          )) {
            setState(() => _error = '현재 표시 가격 문구를 확인해 주세요.');
            return;
          }
          final priceReviews = [
            for (final item in selectedOptions)
              if (item.priceFacts.isNotEmpty)
                <String, Object?>{
                  'importId': item.importId,
                  'sourcePath': _selectedPricePaths[item.importId]!,
                },
          ];
          Navigator.pop(context, <String, Object?>{
            'purpose': _purpose.text.trim(),
            'importIds': selectedOptions.map((item) => item.importId).toList(),
            if (priceReviews.isNotEmpty) 'priceReviews': priceReviews,
          });
        },
        child: const Text('계획 제안 받기'),
      ),
    ],
  );
}

final class ShoppingChoiceDialog extends StatefulWidget {
  const ShoppingChoiceDialog({
    required this.candidates,
    this.recipeItems,
    this.onOpenImport,
    super.key,
  });
  final List<KernelJson> candidates;
  final List<KernelJson>? recipeItems;
  final void Function(String importId)? onOpenImport;
  @override
  State<ShoppingChoiceDialog> createState() => _ShoppingChoiceDialogState();
}

final class _ShoppingChoiceDialogState extends State<ShoppingChoiceDialog> {
  String? _selectedId;
  int _quantity = 1;
  bool _ingredientDecisionMade = false;
  String? _selectedIngredientId;
  bool _packageDecisionMade = false;
  bool _packageKnown = false;
  final _packageAmount = TextEditingController();
  String _packageUnit = 'g';
  String? _error;

  @override
  void dispose() {
    _packageAmount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('상품과 수량 선택'),
    content: SizedBox(
      width: 500,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('화면에서 읽은 정보를 비교하세요. 가격과 옵션은 캡처 당시 표시값입니다.'),
            for (final candidate in widget.candidates)
              Card(
                child: Column(
                  children: [
                    ListTile(
                      key: ValueKey('shopping-choice-${candidate['importId']}'),
                      leading: Icon(
                        _selectedId == _text(candidate['importId'])
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                      ),
                      title: Text(_text(candidate['title'])),
                      subtitle: Text(
                        '캡처 표시 ${_text(candidate['displayedPriceText'])}',
                      ),
                      onTap: () => setState(
                        () => _selectedId = _text(candidate['importId']),
                      ),
                    ),
                    for (final detail
                        in (candidate['details'] is List
                            ? (candidate['details'] as List)
                                  .whereType<Map>()
                                  .toList()
                            : <Map>[]))
                      Padding(
                        padding: const EdgeInsets.only(
                          left: 16,
                          right: 16,
                          bottom: 4,
                        ),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            '${_text(detail['label'])}: ${_text(detail['value'])}',
                          ),
                        ),
                      ),
                    if (widget.onOpenImport != null)
                      TextButton.icon(
                        onPressed: () =>
                            widget.onOpenImport!(_text(candidate['importId'])),
                        icon: const Icon(Icons.image_outlined),
                        label: const Text('원본 캡처 보기'),
                      ),
                  ],
                ),
              ),
            Row(
              children: [
                const Text('수량'),
                IconButton(
                  key: const Key('shopping-quantity-minus'),
                  onPressed: _quantity <= 1
                      ? null
                      : () => setState(() => _quantity--),
                  icon: const Icon(Icons.remove),
                ),
                Text('$_quantity'),
                IconButton(
                  key: const Key('shopping-quantity-plus'),
                  onPressed: _quantity >= 20
                      ? null
                      : () => setState(() => _quantity++),
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
            if (widget.recipeItems != null) ...[
              const SizedBox(height: 12),
              const Text('이 상품이 레시피의 어느 재료에 해당하나요? 상품 수량은 자동 계산하지 않아요.'),
              for (final item in widget.recipeItems!)
                ListTile(
                  key: ValueKey('shopping-ingredient-${item['ingredientId']}'),
                  title: Text(_text(item['name'])),
                  leading: Icon(
                    _ingredientDecisionMade &&
                            _selectedIngredientId == item['ingredientId']
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                  ),
                  onTap: () => setState(() {
                    _ingredientDecisionMade = true;
                    _selectedIngredientId = _text(item['ingredientId']);
                    _packageDecisionMade = false;
                  }),
                ),
              ListTile(
                key: const Key('shopping-ingredient-unverified'),
                title: const Text('어느 재료인지 확인하지 않음'),
                leading: Icon(
                  _ingredientDecisionMade && _selectedIngredientId == null
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                ),
                onTap: () => setState(() {
                  _ingredientDecisionMade = true;
                  _selectedIngredientId = null;
                  _packageDecisionMade = false;
                }),
              ),
              if (_ingredientDecisionMade && _selectedIngredientId != null) ...[
                const SizedBox(height: 12),
                const Text('상품 한 개의 포장 분량을 직접 확인해 주세요. 상품명에서 자동 추정하지 않아요.'),
                ListTile(
                  key: const Key('shopping-package-known'),
                  title: const Text('포장 분량 확인'),
                  leading: Icon(
                    _packageDecisionMade && _packageKnown
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                  ),
                  onTap: () => setState(() {
                    _packageDecisionMade = true;
                    _packageKnown = true;
                  }),
                ),
                if (_packageDecisionMade && _packageKnown)
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('shopping-package-amount'),
                          controller: _packageAmount,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: '상품 한 개의 분량',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      DropdownButton<String>(
                        key: const Key('shopping-package-unit'),
                        value: _packageUnit,
                        items:
                            const ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp']
                                .map(
                                  (unit) => DropdownMenuItem(
                                    value: unit,
                                    child: Text(unit),
                                  ),
                                )
                                .toList(),
                        onChanged: (unit) =>
                            setState(() => _packageUnit = unit!),
                      ),
                    ],
                  ),
                ListTile(
                  key: const Key('shopping-package-unknown'),
                  title: const Text('포장 분량 확인하지 못함'),
                  leading: Icon(
                    _packageDecisionMade && !_packageKnown
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                  ),
                  onTap: () => setState(() {
                    _packageDecisionMade = true;
                    _packageKnown = false;
                  }),
                ),
              ],
            ],
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
        key: const Key('shopping-choice-submit'),
        onPressed: () {
          if (_selectedId == null) {
            setState(() => _error = '상품 하나를 선택해 주세요.');
            return;
          }
          if (widget.recipeItems != null && !_ingredientDecisionMade) {
            setState(() => _error = '해당 재료를 확인하거나 미확인을 선택해 주세요.');
            return;
          }
          if (_selectedIngredientId != null && !_packageDecisionMade) {
            setState(() => _error = '포장 분량을 확인하거나 미확인을 선택해 주세요.');
            return;
          }
          final packageAmount = double.tryParse(_packageAmount.text.trim());
          if (_selectedIngredientId != null &&
              _packageKnown &&
              (packageAmount == null ||
                  !packageAmount.isFinite ||
                  packageAmount <= 0 ||
                  packageAmount > 1000000000)) {
            setState(() => _error = '상품 한 개의 분량을 0보다 큰 숫자로 입력해 주세요.');
            return;
          }
          Navigator.pop(context, <String, Object?>{
            'selectedImportId': _selectedId,
            'quantity': _quantity,
            if (widget.recipeItems != null)
              'ingredientMatch': _selectedIngredientId == null
                  ? {'status': 'unverified'}
                  : {
                      'status': 'matched',
                      'ingredientId': _selectedIngredientId,
                    },
            if (_selectedIngredientId != null)
              'packageQuantity': _packageKnown
                  ? {
                      'status': 'known',
                      'amount': packageAmount,
                      'unit': _packageUnit,
                    }
                  : {'status': 'unknown'},
          });
        },
        child: const Text('선택 확정'),
      ),
    ],
  );
}

final class _BasketSelection {
  _BasketSelection(this.ingredientId);
  final String ingredientId;
  String? importId;
  int quantity = 1;
  bool? packageKnown;
  final amount = TextEditingController();
  String unit = 'g';
  List<String> packageEvidenceIds = [];
  void dispose() => amount.dispose();
}

final class ShoppingBasketDialog extends StatefulWidget {
  const ShoppingBasketDialog({
    required this.candidates,
    required this.recipeItems,
    this.onOpenImport,
    this.initialBasket,
    this.allowEmpty = false,
    super.key,
  });
  final List<KernelJson> candidates;
  final List<KernelJson> recipeItems;
  final void Function(String importId)? onOpenImport;
  final KernelJson? initialBasket;
  final bool allowEmpty;
  @override
  State<ShoppingBasketDialog> createState() => _ShoppingBasketDialogState();
}

final class _ShoppingBasketDialogState extends State<ShoppingBasketDialog> {
  final _selections = <_BasketSelection>[];
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final rawLine in widget.initialBasket?['lines'] as List? ?? []) {
      final line = Map<String, Object?>.from(rawLine as Map);
      for (final rawChoice in line['choices'] as List? ?? []) {
        final choice = Map<String, Object?>.from(rawChoice as Map);
        final package = Map<String, Object?>.from(
          choice['packageQuantity'] as Map,
        );
        final selection = _BasketSelection(line['ingredientId'] as String)
          ..importId = choice['importId'] as String
          ..quantity = choice['quantity'] as int
          ..packageKnown = package['status'] == 'known'
          ..packageEvidenceIds = (choice['packageEvidenceIds'] as List? ?? [])
              .whereType<String>()
              .toList();
        if (package['status'] == 'known') {
          selection.amount.text = '${package['amount']}';
          selection.unit = package['unit'] as String;
        }
        _selections.add(selection);
      }
    }
  }

  @override
  void dispose() {
    for (final selection in _selections) {
      selection.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('재료별 장보기 상품'),
    content: SizedBox(
      width: 560,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '재료마다 상품을 선택하세요. 한 재료에 여러 상품을 담을 수 있고, 고르지 않은 재료는 그대로 남습니다.',
            ),
            const SizedBox(height: 8),
            for (final item in widget.recipeItems) ...[
              const Divider(),
              Text(
                _text(item['name']),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              Text('부족량: ${_quantityLabel(item['missingQuantity'])}'),
              for (final selection in _selections.where(
                (entry) => entry.ingredientId == item['ingredientId'],
              ))
                Card(
                  key: ObjectKey(selection),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                key: ValueKey(
                                  'basket-product-${item['ingredientId']}-${_selections.indexOf(selection)}',
                                ),
                                initialValue: selection.importId,
                                decoration: const InputDecoration(
                                  labelText: '상품 후보',
                                ),
                                items: widget.candidates
                                    .map(
                                      (candidate) => DropdownMenuItem(
                                        value: _text(candidate['importId']),
                                        child: Text(
                                          '${_text(candidate['title'])} · ${_text(candidate['displayedPriceText'])}',
                                        ),
                                      ),
                                    )
                                    .toList(),
                                onChanged: (value) => setState(() {
                                  selection.importId = value;
                                  selection.packageKnown = null;
                                  selection.amount.clear();
                                  selection.packageEvidenceIds = [];
                                }),
                              ),
                            ),
                            IconButton(
                              tooltip: '상품 빼기',
                              onPressed: () => setState(() {
                                _selections.remove(selection);
                                selection.dispose();
                              }),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                        if (selection.importId != null &&
                            widget.onOpenImport != null)
                          TextButton.icon(
                            onPressed: () =>
                                widget.onOpenImport!(selection.importId!),
                            icon: const Icon(Icons.image_outlined),
                            label: const Text('원본 캡처 보기'),
                          ),
                        if (selection.importId != null)
                          for (final suggestion in _packageSuggestions(
                            widget.candidates.firstWhere(
                              (candidate) =>
                                  candidate['importId'] == selection.importId,
                            ),
                          ))
                            ActionChip(
                              label: Text('화면에 표시된 ${suggestion.label} 사용'),
                              onPressed: () => setState(() {
                                selection.packageKnown = true;
                                selection.amount.text = suggestion.amount;
                                selection.unit = suggestion.unit;
                                selection.packageEvidenceIds =
                                    suggestion.evidenceIds;
                              }),
                            ),
                        Row(
                          children: [
                            const Text('상품 개수'),
                            IconButton(
                              onPressed: selection.quantity <= 1
                                  ? null
                                  : () => setState(() => selection.quantity--),
                              icon: const Icon(Icons.remove),
                            ),
                            Text('${selection.quantity}'),
                            IconButton(
                              onPressed: selection.quantity >= 20
                                  ? null
                                  : () => setState(() => selection.quantity++),
                              icon: const Icon(Icons.add),
                            ),
                          ],
                        ),
                        const Text('상품 한 개의 포장 분량을 직접 확인해 주세요.'),
                        Wrap(
                          spacing: 8,
                          children: [
                            ChoiceChip(
                              label: const Text('분량 확인'),
                              selected: selection.packageKnown == true,
                              onSelected: (_) =>
                                  setState(() => selection.packageKnown = true),
                            ),
                            ChoiceChip(
                              label: const Text('확인 못함'),
                              selected: selection.packageKnown == false,
                              onSelected: (_) => setState(
                                () => selection.packageKnown = false,
                              ),
                            ),
                          ],
                        ),
                        if (selection.packageKnown == true)
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  key: ValueKey(
                                    'basket-amount-${item['ingredientId']}-${_selections.indexOf(selection)}',
                                  ),
                                  controller: selection.amount,
                                  onChanged: (_) =>
                                      selection.packageEvidenceIds = [],
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                  decoration: const InputDecoration(
                                    labelText: '한 개의 분량',
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              DropdownButton<String>(
                                value: selection.unit,
                                items:
                                    const [
                                          'g',
                                          'kg',
                                          'ml',
                                          'l',
                                          'count',
                                          'tsp',
                                          'tbsp',
                                        ]
                                        .map(
                                          (unit) => DropdownMenuItem(
                                            value: unit,
                                            child: Text(unit),
                                          ),
                                        )
                                        .toList(),
                                onChanged: (value) => setState(() {
                                  selection.unit = value!;
                                  selection.packageEvidenceIds = [];
                                }),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
              TextButton.icon(
                key: ValueKey('basket-add-${item['ingredientId']}'),
                onPressed: _selections.length >= 8
                    ? null
                    : () => setState(
                        () => _selections.add(
                          _BasketSelection(_text(item['ingredientId'])),
                        ),
                      ),
                icon: const Icon(Icons.add),
                label: const Text('이 재료에 상품 추가'),
              ),
            ],
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
        key: const Key('basket-confirm'),
        onPressed: () {
          if (_selections.isEmpty && !widget.allowEmpty) {
            setState(() => _error = '상품을 하나 이상 선택해 주세요.');
            return;
          }
          final selections = <KernelJson>[];
          final used = <String>{};
          for (final selection in _selections) {
            if (selection.importId == null || !used.add(selection.importId!)) {
              setState(() => _error = '상품 후보를 고르고 중복 선택을 없애 주세요.');
              return;
            }
            if (selection.packageKnown == null) {
              setState(() => _error = '각 상품의 포장 분량을 확인하거나 미확인을 선택해 주세요.');
              return;
            }
            final amount = double.tryParse(selection.amount.text.trim());
            if (selection.packageKnown == true &&
                (amount == null ||
                    !amount.isFinite ||
                    amount <= 0 ||
                    amount > 1000000000)) {
              setState(() => _error = '상품 한 개의 분량을 0보다 큰 숫자로 입력해 주세요.');
              return;
            }
            selections.add({
              'ingredientId': selection.ingredientId,
              'selectedImportId': selection.importId,
              'quantity': selection.quantity,
              'packageQuantity': selection.packageKnown == true
                  ? {
                      'status': 'known',
                      'amount': amount,
                      'unit': selection.unit,
                    }
                  : {'status': 'unknown'},
              if (selection.packageKnown == true &&
                  selection.packageEvidenceIds.isNotEmpty)
                'packageEvidenceIds': selection.packageEvidenceIds,
            });
          }
          Navigator.pop(context, <String, Object?>{'selections': selections});
        },
        child: const Text('장보기 목록 확정'),
      ),
    ],
  );
}

String _quantityLabel(Object? raw) {
  if (raw is! Map) return '미확인';
  if (raw['status'] == 'known') return '${raw['amount']}${raw['unit']}';
  if (raw['status'] == 'as_needed') return '필요한 만큼';
  return '미확인';
}

List<({String label, String amount, String unit, List<String> evidenceIds})>
_packageSuggestions(KernelJson candidate) {
  final suggestions =
      <
        ({String label, String amount, String unit, List<String> evidenceIds})
      >[];
  final sources = <(String, List<String>)>[
    (
      _text(candidate['title']),
      (candidate['titleEvidenceIds'] as List? ?? [])
          .whereType<String>()
          .toList(),
    ),
    for (final detail in (candidate['details'] as List? ?? []).whereType<Map>())
      (
        _text(detail['value']),
        (detail['evidenceIds'] as List? ?? []).whereType<String>().toList(),
      ),
  ];
  final pattern = RegExp(
    r'(\d+(?:\.\d+)?)\s*(kg|ml|g|l|개)(?:입)?(?![A-Za-z가-힣])',
    caseSensitive: false,
  );
  for (final (text, evidenceIds) in sources) {
    for (final match in pattern.allMatches(text)) {
      final unit = match.group(2)!.toLowerCase();
      suggestions.add((
        label: match.group(0)!,
        amount: match.group(1)!,
        unit: unit == '개' ? 'count' : unit,
        evidenceIds: evidenceIds,
      ));
    }
  }
  return suggestions;
}

final class ShoppingBasketOutcomeDialog extends StatefulWidget {
  const ShoppingBasketOutcomeDialog({required this.basket, super.key});
  final KernelJson basket;
  @override
  State<ShoppingBasketOutcomeDialog> createState() =>
      _ShoppingBasketOutcomeDialogState();
}

final class _ShoppingBasketOutcomeDialogState
    extends State<ShoppingBasketOutcomeDialog> {
  final _statuses = <String, String>{};
  final _paid = <String, TextEditingController>{};
  String? _error;

  @override
  void dispose() {
    for (final controller in _paid.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lines = (widget.basket['lines'] as List? ?? [])
        .whereType<Map>()
        .toList();
    final choices = lines
        .expand((line) => (line['choices'] as List? ?? []).whereType<Map>())
        .toList();
    for (final choice in choices) {
      _paid.putIfAbsent(_text(choice['id']), TextEditingController.new);
    }
    return AlertDialog(
      title: const Text('상품별 실제 구매 결과'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('상품 선택은 구매가 아닙니다. 각 상품의 결과를 직접 기록해 주세요.'),
              for (final choice in choices) ...[
                const Divider(),
                Text('${_text(choice['title'])} · ${choice['quantity']}개'),
                for (final (status, label) in [
                  ('purchased', '구매했어요'),
                  ('not_purchased', '구매하지 않았어요'),
                  ('unknown', '아직 몰라요'),
                ])
                  ListTile(
                    key: ValueKey('basket-outcome-${choice['id']}-$status'),
                    title: Text(label),
                    leading: Icon(
                      _statuses[_text(choice['id'])] == status
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                    ),
                    onTap: () =>
                        setState(() => _statuses[_text(choice['id'])] = status),
                  ),
                if (_statuses[_text(choice['id'])] == 'purchased')
                  TextField(
                    controller: _paid[_text(choice['id'])],
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: '실제 지불액 (원)'),
                  ),
              ],
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
          key: const Key('basket-outcomes-confirm'),
          onPressed: () {
            final outcomes = <KernelJson>[];
            for (final choice in choices) {
              final id = _text(choice['id']);
              final status = _statuses[id];
              if (status == null) {
                setState(() => _error = '모든 상품의 구매 결과를 선택해 주세요.');
                return;
              }
              final amount = int.tryParse(_paid[id]!.text.trim());
              if (status == 'purchased' &&
                  (amount == null || amount < 1 || amount > 1000000000)) {
                setState(() => _error = '구매한 상품의 실제 지불액을 입력해 주세요.');
                return;
              }
              outcomes.add({
                'choiceId': id,
                'status': status,
                if (status == 'purchased') 'actualPaidKrw': amount,
              });
            }
            Navigator.pop(context, <String, Object?>{'outcomes': outcomes});
          },
          child: const Text('구매 결과 기록'),
        ),
      ],
    );
  }
}

final class ShoppingInventoryDialog extends StatefulWidget {
  const ShoppingInventoryDialog({
    required this.basket,
    required this.outcomes,
    required this.previous,
    super.key,
  });
  final KernelJson basket;
  final List<KernelJson> outcomes;
  final List<KernelJson> previous;
  @override
  State<ShoppingInventoryDialog> createState() =>
      _ShoppingInventoryDialogState();
}

final class _ShoppingInventoryDialogState
    extends State<ShoppingInventoryDialog> {
  final _selected = <String>{};
  final _amounts = <String, TextEditingController>{};
  final _units = <String, String>{};
  String? _error;

  @override
  void dispose() {
    for (final controller in _amounts.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bought = widget.outcomes
        .where((item) => item['status'] == 'purchased')
        .map((item) => _text(item['choiceId']))
        .toSet();
    final lines = (widget.basket['lines'] as List? ?? [])
        .whereType<Map>()
        .where(
          (line) => (line['choices'] as List? ?? []).whereType<Map>().any(
            (choice) => bought.contains(_text(choice['id'])),
          ),
        )
        .toList();
    for (final line in lines) {
      final id = _text(line['ingredientId']);
      _amounts.putIfAbsent(id, TextEditingController.new);
      _units.putIfAbsent(id, () {
        final missing = line['missingQuantity'];
        return missing is Map && missing['status'] == 'known'
            ? _text(missing['unit'])
            : 'g';
      });
    }
    return AlertDialog(
      title: const Text('실제 보유량 확인'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '구매 기록만으로 재고를 늘리지 않습니다. 지금 실제로 보유한 총량을 확인한 재료만 기록하세요.',
              ),
              for (final old in widget.previous)
                Text(
                  '이전 확인: ${_text(old['ingredientId'])} · ${_quantityLabel(old['quantity'])}',
                ),
              for (final line in lines) ...[
                CheckboxListTile(
                  title: Text(_text(line['name'])),
                  value: _selected.contains(_text(line['ingredientId'])),
                  onChanged: (value) => setState(() {
                    if (value == true) {
                      _selected.add(_text(line['ingredientId']));
                    } else {
                      _selected.remove(_text(line['ingredientId']));
                    }
                  }),
                ),
                if (_selected.contains(_text(line['ingredientId'])))
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: ValueKey(
                            'inventory-amount-${line['ingredientId']}',
                          ),
                          controller: _amounts[_text(line['ingredientId'])],
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: '현재 실제 보유 총량',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      DropdownButton<String>(
                        value: _units[_text(line['ingredientId'])],
                        items:
                            const ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp']
                                .map(
                                  (unit) => DropdownMenuItem(
                                    value: unit,
                                    child: Text(unit),
                                  ),
                                )
                                .toList(),
                        onChanged: (value) => setState(
                          () => _units[_text(line['ingredientId'])] = value!,
                        ),
                      ),
                    ],
                  ),
              ],
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
          key: const Key('inventory-confirm'),
          onPressed: () {
            if (_selected.isEmpty) {
              setState(() => _error = '확인한 재료를 선택해 주세요.');
              return;
            }
            final observations = <KernelJson>[];
            for (final line in lines.where(
              (line) => _selected.contains(_text(line['ingredientId'])),
            )) {
              final id = _text(line['ingredientId']);
              final amount = double.tryParse(_amounts[id]!.text.trim());
              if (amount == null ||
                  !amount.isFinite ||
                  amount < 0 ||
                  amount > 1000000000) {
                setState(() => _error = '실제로 보유한 양을 0 이상 숫자로 입력해 주세요.');
                return;
              }
              final supporting = (line['choices'] as List? ?? [])
                  .whereType<Map>()
                  .map((choice) => _text(choice['id']))
                  .where(bought.contains)
                  .toList();
              observations.add({
                'ingredientId': id,
                'quantity': {
                  'status': 'known',
                  'amount': amount,
                  'unit': _units[id],
                },
                'supportingChoiceIds': supporting,
              });
            }
            Navigator.pop(context, <String, Object?>{
              'observations': observations,
            });
          },
          child: const Text('보유량 기록'),
        ),
      ],
    );
  }
}

final class ShoppingPurchaseCorrectionDialog extends StatefulWidget {
  const ShoppingPurchaseCorrectionDialog({
    required this.choice,
    required this.outcomes,
    super.key,
  });

  final KernelJson choice;
  final List<KernelJson> outcomes;

  @override
  State<ShoppingPurchaseCorrectionDialog> createState() =>
      _ShoppingPurchaseCorrectionDialogState();
}

final class _ShoppingPurchaseCorrectionDialogState
    extends State<ShoppingPurchaseCorrectionDialog> {
  String? _choiceId;
  String? _status;
  final _paid = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _paid.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final choices = widget.choice['kind'] == 'basket'
        ? (widget.choice['lines'] as List? ?? [])
              .whereType<Map>()
              .expand(
                (line) => (line['choices'] as List? ?? []).whereType<Map>(),
              )
              .toList()
        : <Map>[widget.choice];
    final choiceId = _choiceId ?? _text(choices.first['id']);
    final current = widget.outcomes.firstWhere(
      (item) => item['choiceId'] == choiceId,
      orElse: () => <String, Object?>{},
    );
    final status = _status ?? _text(current['status']);
    return AlertDialog(
      title: const Text('실제 구매 결과 정정'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('선택 당시 기록은 이력으로 남고, 현재 유효한 구매 결과를 고칩니다.'),
              DropdownButtonFormField<String>(
                key: const Key('shopping-correct-choice'),
                initialValue: choiceId,
                decoration: const InputDecoration(labelText: '정정할 상품'),
                items: choices
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: _text(item['id']),
                        child: Text(_text(item['title'])),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  _choiceId = value;
                  _status = null;
                  _paid.clear();
                }),
              ),
              for (final (value, label) in [
                ('purchased', '구매했어요'),
                ('not_purchased', '구매하지 않았어요'),
                ('unknown', '아직 몰라요'),
              ])
                ListTile(
                  key: ValueKey('shopping-correct-status-$value'),
                  title: Text(label),
                  leading: Icon(
                    status == value
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                  ),
                  onTap: () => setState(() => _status = value),
                ),
              if (status == 'purchased')
                TextField(
                  key: const Key('shopping-correct-paid'),
                  controller: _paid,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: '실제 지불액 (원)',
                    hintText: current['actualPaidKrw'] is int
                        ? '${current['actualPaidKrw']}'
                        : null,
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
          key: const Key('shopping-correct-purchase-confirm'),
          onPressed: () {
            final amount =
                int.tryParse(_paid.text.trim()) ??
                (current['actualPaidKrw'] is int
                    ? current['actualPaidKrw'] as int
                    : null);
            if (status == 'purchased' &&
                (amount == null || amount < 1 || amount > 1000000000)) {
              setState(() => _error = '실제 지불액을 확인해 주세요.');
              return;
            }
            Navigator.pop(context, <String, Object?>{
              'choiceId': choiceId,
              'status': status,
              if (status == 'purchased') 'actualPaidKrw': amount,
            });
          },
          child: const Text('정정'),
        ),
      ],
    );
  }
}

final class ShoppingInventoryCorrectionDialog extends StatefulWidget {
  const ShoppingInventoryCorrectionDialog({
    required this.observations,
    super.key,
  });

  final List<KernelJson> observations;

  @override
  State<ShoppingInventoryCorrectionDialog> createState() =>
      _ShoppingInventoryCorrectionDialogState();
}

final class ShoppingInventorySupportDialog extends StatefulWidget {
  const ShoppingInventorySupportDialog({
    required this.basket,
    required this.outcomes,
    required this.observations,
    super.key,
  });

  final KernelJson basket;
  final List<KernelJson> outcomes;
  final List<KernelJson> observations;

  @override
  State<ShoppingInventorySupportDialog> createState() =>
      _ShoppingInventorySupportDialogState();
}

final class _ShoppingInventorySupportDialogState
    extends State<ShoppingInventorySupportDialog> {
  String? _observationId;
  final _selected = <String, Set<String>>{};
  String? _error;

  @override
  Widget build(BuildContext context) {
    final observationId =
        _observationId ?? _text(widget.observations.first['observationId']);
    final observation = widget.observations.firstWhere(
      (item) => item['observationId'] == observationId,
    );
    final purchased = widget.outcomes
        .where((item) => item['status'] == 'purchased')
        .map((item) => _text(item['choiceId']))
        .toSet();
    final line = (widget.basket['lines'] as List? ?? [])
        .whereType<Map>()
        .where((item) => item['ingredientId'] == observation['ingredientId'])
        .firstOrNull;
    final choices = (line?['choices'] as List? ?? [])
        .whereType<Map>()
        .where((item) => purchased.contains(_text(item['id'])))
        .toList();
    final selected = _selected.putIfAbsent(
      observationId,
      () => (observation['supportingChoiceIds'] as List? ?? [])
          .whereType<String>()
          .toSet(),
    );
    return AlertDialog(
      title: const Text('재고 관측의 근거 상품 정정'),
      content: SizedBox(
        width: 470,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('같은 재료에서 실제 구매한 상품만 근거로 연결할 수 있습니다.'),
              DropdownButtonFormField<String>(
                key: const Key('shopping-support-observation'),
                initialValue: observationId,
                decoration: const InputDecoration(labelText: '정정할 관측'),
                items: widget.observations
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: _text(item['observationId']),
                        child: Text(
                          '${_text(item['ingredientId'])} · '
                          '${_quantityLabel(item['quantity'])}',
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  _observationId = value;
                  _error = null;
                }),
              ),
              for (final choice in choices)
                CheckboxListTile(
                  key: ValueKey('shopping-support-choice-${choice['id']}'),
                  title: Text(_text(choice['title'])),
                  value: selected.contains(_text(choice['id'])),
                  onChanged: (value) => setState(() {
                    final id = _text(choice['id']);
                    if (value == true) {
                      selected.add(id);
                    } else {
                      selected.remove(id);
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
          key: const Key('shopping-support-confirm'),
          onPressed: () {
            if (selected.isEmpty) {
              setState(() => _error = '근거 상품을 하나 이상 선택해 주세요.');
              return;
            }
            final old = (observation['supportingChoiceIds'] as List? ?? [])
                .whereType<String>()
                .toSet();
            if (old.length == selected.length && old.containsAll(selected)) {
              setState(() => _error = '현재 근거 상품과 같아요.');
              return;
            }
            Navigator.pop(context, <String, Object?>{
              'observationId': observationId,
              'expectedGraphFingerprint': observation['graphFingerprint'],
              'supportingChoiceIds': selected.toList()..sort(),
            });
          },
          child: const Text('근거 정정'),
        ),
      ],
    );
  }
}

final class ShoppingInventoryCancellationDialog extends StatefulWidget {
  const ShoppingInventoryCancellationDialog({
    required this.observations,
    super.key,
  });

  final List<KernelJson> observations;

  @override
  State<ShoppingInventoryCancellationDialog> createState() =>
      _ShoppingInventoryCancellationDialogState();
}

final class _ShoppingInventoryCancellationDialogState
    extends State<ShoppingInventoryCancellationDialog> {
  String? _observationId;

  @override
  Widget build(BuildContext context) {
    final observationId =
        _observationId ?? _text(widget.observations.first['observationId']);
    final observation = widget.observations.firstWhere(
      (item) => item['observationId'] == observationId,
    );
    return AlertDialog(
      title: const Text('재고 관측 취소'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('이 관측은 현재 재고 판단에서 제외됩니다. 원래 보고와 취소 이력은 남습니다.'),
            DropdownButtonFormField<String>(
              key: const Key('shopping-cancel-observation'),
              initialValue: observationId,
              decoration: const InputDecoration(labelText: '취소할 관측'),
              items: widget.observations
                  .map(
                    (item) => DropdownMenuItem<String>(
                      value: _text(item['observationId']),
                      child: Text(
                        '${_text(item['ingredientId'])} · '
                        '${_quantityLabel(item['quantity'])}',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => _observationId = value),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('돌아가기'),
        ),
        FilledButton(
          key: const Key('shopping-cancel-inventory-confirm'),
          onPressed: () => Navigator.pop(context, <String, Object?>{
            'observationId': observationId,
            'expectedGraphFingerprint': observation['graphFingerprint'],
          }),
          child: const Text('관측 취소'),
        ),
      ],
    );
  }
}

final class _ShoppingInventoryCorrectionDialogState
    extends State<ShoppingInventoryCorrectionDialog> {
  String? _observationId;
  final _amount = TextEditingController();
  String? _unit;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final observationId =
        _observationId ?? _text(widget.observations.first['observationId']);
    final current = widget.observations.firstWhere(
      (item) => item['observationId'] == observationId,
    );
    final quantity = current['quantity'] as Map? ?? {};
    final unit = _unit ?? _text(quantity['unit']);
    return AlertDialog(
      title: const Text('실제 보유량 정정'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('같은 관측 기록의 수치만 고칩니다. 새로 확인한 재고는 별도 기록으로 남겨 주세요.'),
            DropdownButtonFormField<String>(
              key: const Key('shopping-correct-inventory-choice'),
              initialValue: observationId,
              decoration: const InputDecoration(labelText: '정정할 관측'),
              items: widget.observations
                  .map(
                    (item) => DropdownMenuItem<String>(
                      value: _text(item['observationId']),
                      child: Text(
                        '${_text(item['ingredientId'])} · '
                        '${_quantityLabel(item['quantity'])}',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() {
                _observationId = value;
                _amount.clear();
                _unit = null;
              }),
            ),
            TextField(
              key: const Key('shopping-correct-inventory-amount'),
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: '정정한 실제 보유량',
                hintText: '${quantity['amount']}',
              ),
            ),
            DropdownButton<String>(
              value: unit,
              items: const ['g', 'kg', 'ml', 'l', 'count', 'tsp', 'tbsp']
                  .map(
                    (value) =>
                        DropdownMenuItem(value: value, child: Text(value)),
                  )
                  .toList(),
              onChanged: (value) => setState(() => _unit = value),
            ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
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
          key: const Key('shopping-correct-inventory-confirm'),
          onPressed: () {
            final amount = double.tryParse(_amount.text.trim());
            if (amount == null ||
                !amount.isFinite ||
                amount < 0 ||
                amount > 1000000000) {
              setState(() => _error = '정정한 보유량을 0 이상 숫자로 입력해 주세요.');
              return;
            }
            Navigator.pop(context, <String, Object?>{
              'observationId': observationId,
              'expectedAssertionId': current['assertionId'],
              'quantity': {'status': 'known', 'amount': amount, 'unit': unit},
            });
          },
          child: const Text('정정'),
        ),
      ],
    );
  }
}

final class ShoppingOutcomeDialog extends StatefulWidget {
  const ShoppingOutcomeDialog({required this.choice, super.key});
  final KernelJson choice;
  @override
  State<ShoppingOutcomeDialog> createState() => _ShoppingOutcomeDialogState();
}

final class _ShoppingOutcomeDialogState extends State<ShoppingOutcomeDialog> {
  String _status = 'unknown';
  final _paid = TextEditingController();
  String? _error;
  @override
  void dispose() {
    _paid.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('실제 구매 결과'),
    content: SizedBox(
      width: 420,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${_text(widget.choice['title'])} · ${widget.choice['quantity']}개',
            ),
            Text('캡처 당시 표시 가격: ${_text(widget.choice['displayedPriceText'])}'),
            const Text('선택만으로 구매가 확인되지 않습니다. 실제 결과를 직접 기록해 주세요.'),
            for (final (value, label) in [
              ('purchased', '구매했어요'),
              ('not_purchased', '구매하지 않았어요'),
              ('unknown', '아직 몰라요'),
            ])
              ListTile(
                key: ValueKey('shopping-outcome-$value'),
                title: Text(label),
                leading: Icon(
                  _status == value
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                ),
                onTap: () => setState(() => _status = value),
              ),
            if (_status == 'purchased')
              TextField(
                key: const Key('shopping-actual-paid'),
                controller: _paid,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: '실제 지불액 (원)',
                  hintText: '캡처 가격이 아닌 실제 지불액',
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
        key: const Key('shopping-outcome-submit'),
        onPressed: () {
          final actual = int.tryParse(_paid.text.trim());
          if (_status == 'purchased' &&
              (actual == null || actual < 1 || actual > 1000000000)) {
            setState(() => _error = '실제 지불액을 1원 이상으로 입력해 주세요.');
            return;
          }
          Navigator.pop(context, <String, Object?>{
            'status': _status,
            if (_status == 'purchased') 'actualPaidKrw': actual,
          });
        },
        child: const Text('결과 기록'),
      ),
    ],
  );
}
