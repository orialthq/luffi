import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class ShoppingImportOption {
  const ShoppingImportOption({
    required this.importId,
    required this.title,
    required this.displayedPriceText,
  });
  final String importId;
  final String title;
  final String displayedPriceText;
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
            for (final option in widget.options)
              CheckboxListTile(
                key: ValueKey('shopping-import-${option.importId}'),
                value: _selected.contains(option.importId),
                title: Text(option.title),
                subtitle: Text('캡처 표시 ${option.displayedPriceText}'),
                onChanged: (checked) => setState(() {
                  if (checked == true) {
                    _selected.add(option.importId);
                  } else {
                    _selected.remove(option.importId);
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
        key: const Key('shopping-create-submit'),
        onPressed: () {
          if (_purpose.text.trim().isEmpty ||
              _selected.isEmpty ||
              _selected.length > 8) {
            setState(() => _error = '목적과 상품 1~8개를 확인해 주세요.');
            return;
          }
          Navigator.pop(context, <String, Object?>{
            'purpose': _purpose.text.trim(),
            'importIds': widget.options
                .where((item) => _selected.contains(item.importId))
                .map((item) => item.importId)
                .toList(),
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
    this.onOpenImport,
    super.key,
  });
  final List<KernelJson> candidates;
  final void Function(String importId)? onOpenImport;
  @override
  State<ShoppingChoiceDialog> createState() => _ShoppingChoiceDialogState();
}

final class _ShoppingChoiceDialogState extends State<ShoppingChoiceDialog> {
  String? _selectedId;
  int _quantity = 1;
  String? _error;

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
          Navigator.pop(context, <String, Object?>{
            'selectedImportId': _selectedId,
            'quantity': _quantity,
          });
        },
        child: const Text('선택 확정'),
      ),
    ],
  );
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
