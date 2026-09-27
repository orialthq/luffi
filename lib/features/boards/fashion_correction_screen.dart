import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

final class FashionCorrectionScreen extends StatefulWidget {
  const FashionCorrectionScreen({
    required this.client,
    required this.activityId,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;

  @override
  State<FashionCorrectionScreen> createState() =>
      _FashionCorrectionScreenState();
}

final class _FashionItem {
  _FashionItem(KernelJson value)
    : variantId = value['variantId'] as String,
      label = '${value['color']} · ${value['size']}',
      color = TextEditingController(text: value['color'] as String),
      size = TextEditingController(text: value['size'] as String),
      slot = value['slot'] as String,
      ownership = value['ownership'] as String;

  final String variantId;
  final String label;
  final TextEditingController color;
  final TextEditingController size;
  String slot;
  String ownership;

  void dispose() {
    color.dispose();
    size.dispose();
  }
}

final class _FashionCorrectionScreenState
    extends State<FashionCorrectionScreen> {
  static const _slots = <String, String>{
    'outerwear': '겉옷',
    'top': '상의',
    'bottom': '하의',
    'shoes': '신발',
    'accessory': '액세서리',
  };
  static const _ownerships = <String, String>{
    'owned': '가지고 있어요',
    'candidate': '후보예요',
    'unknown': '확인되지 않았어요',
  };

  final _items = <_FashionItem>[];
  final _allItems = <_FashionItem>[];
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
    for (final item in _allItems) {
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
      final data = await widget.client.getEditableFashionOutfit(
        widget.activityId,
      );
      if (!mounted) return;
      _items
        ..clear()
        ..addAll(
          (data['items'] as List).map(
            (raw) => _FashionItem(Map<String, Object?>.from(raw as Map)),
          ),
        );
      _allItems.addAll(_items);
      setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review() async {
    if (_busy || _pending != null || _data == null) return;
    if (_items.map((item) => item.slot).toSet().length != _items.length) {
      setState(() => _error = '같은 코디 자리에 두 상품을 둘 수 없어요.');
      return;
    }
    if (_items.any(
      (item) =>
          item.color.text.trim().isEmpty ||
          item.color.text.trim().length > 80 ||
          item.size.text.trim().isEmpty ||
          item.size.text.trim().length > 80,
    )) {
      setState(() => _error = '색상과 사이즈를 각각 1~80자로 입력해 주세요.');
      return;
    }
    final items = _items
        .map(
          (item) => <String, Object?>{
            'variantId': item.variantId,
            'slot': item.slot,
            'ownership': item.ownership,
            'color': item.color.text.trim(),
            'size': item.size.text.trim(),
          },
        )
        .toList();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('코디 정정 확인'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final entry in _items.asMap().entries)
                Text(
                  '${_slots[entry.value.slot]} · '
                  '${entry.value.color.text.trim()} · ${entry.value.size.text.trim()} · '
                  '${_ownerships[entry.value.ownership]}',
                ),
              const SizedBox(height: 12),
              const Text('처음 확정한 코디와 착용 기록은 보존됩니다. 변경된 계획은 새 활동에서 다시 확인해요.'),
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
    if (!mounted || accepted != true) return;
    _pending = {
      'commandId': newKernelCommandId(),
      'activityId': widget.activityId,
      'expectedGraphFingerprint': _data!['graphFingerprint'],
      'items': items,
      'confirmed': true,
    };
    await _submit();
  }

  Future<void> _submit() async {
    final request = _pending;
    if (_busy || request == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.correctFashionOutfit(request);
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

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('코디 옵션·자리 정정')),
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
                const Text(
                  '현재 코디의 색상·사이즈·자리·소유 상태를 정정합니다. 옵션을 바꾸면 새 상품 옵션으로 연결됩니다.',
                ),
                ExpansionTile(
                  title: const Text('처음 확정한 코디 보기'),
                  children: [
                    for (final raw in _data!['originalItems'] as List)
                      ListTile(
                        title: Text(
                          '${(raw as Map)['slot']} · '
                          '${raw['color']} · ${raw['size']} · ${raw['ownership']}',
                        ),
                      ),
                  ],
                ),
                for (final item in _items)
                  Card(
                    key: ValueKey('fashion-item-${item.variantId}'),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('처음 선택한 옵션: ${item.label}'),
                          TextField(
                            key: Key('fashion-color-${item.variantId}'),
                            controller: item.color,
                            maxLength: 80,
                            decoration: const InputDecoration(labelText: '색상'),
                          ),
                          TextField(
                            key: Key('fashion-size-${item.variantId}'),
                            controller: item.size,
                            maxLength: 80,
                            decoration: const InputDecoration(labelText: '사이즈'),
                          ),
                          DropdownButtonFormField<String>(
                            initialValue: item.slot,
                            decoration: const InputDecoration(
                              labelText: '코디 자리',
                            ),
                            items: _slots.entries
                                .map(
                                  (entry) => DropdownMenuItem(
                                    value: entry.key,
                                    child: Text(entry.value),
                                  ),
                                )
                                .toList(),
                            onChanged: _busy
                                ? null
                                : (value) => setState(
                                    () => item.slot = value ?? item.slot,
                                  ),
                          ),
                          DropdownButtonFormField<String>(
                            initialValue: item.ownership,
                            decoration: const InputDecoration(
                              labelText: '소유 상태',
                            ),
                            items: _ownerships.entries
                                .map(
                                  (entry) => DropdownMenuItem(
                                    value: entry.key,
                                    child: Text(entry.value),
                                  ),
                                )
                                .toList(),
                            onChanged: _busy
                                ? null
                                : (value) => setState(
                                    () => item.ownership =
                                        value ?? item.ownership,
                                  ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('submit-fashion-correction'),
                  onPressed: _busy || _pending != null ? null : _review,
                  child: const Text('변경 내용 검토'),
                ),
              ],
            ],
          ),
  );
}
