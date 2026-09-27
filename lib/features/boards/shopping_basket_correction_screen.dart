import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';
import 'shopping_scenario_dialogs.dart';

final class ShoppingBasketCorrectionScreen extends StatefulWidget {
  const ShoppingBasketCorrectionScreen({
    required this.client,
    required this.activityId,
    this.onOpenImport,
    super.key,
  });

  final CommonKernelClient client;
  final String activityId;
  final void Function(String importId)? onOpenImport;

  @override
  State<ShoppingBasketCorrectionScreen> createState() =>
      _ShoppingBasketCorrectionScreenState();
}

final class _ShoppingBasketCorrectionScreenState
    extends State<ShoppingBasketCorrectionScreen> {
  KernelJson? _data;
  KernelJson? _pending;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.client.getEditableShoppingBasket(
        widget.activityId,
      );
      if (mounted) setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit() async {
    final data = _data;
    if (_busy || _pending != null || data == null) return;
    final selection = await showDialog<KernelJson>(
      context: context,
      builder: (_) => ShoppingBasketDialog(
        candidates: (data['candidates'] as List)
            .whereType<Map>()
            .map((item) => Map<String, Object?>.from(item))
            .toList(),
        recipeItems: (data['recipeItems'] as List)
            .whereType<Map>()
            .map((item) => Map<String, Object?>.from(item))
            .toList(),
        initialBasket: Map<String, Object?>.from(data['basket'] as Map),
        allowEmpty: true,
        onOpenImport: widget.onOpenImport,
      ),
    );
    if (!mounted || selection == null) return;
    final selections = selection['selections'] as List;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('장보기 묶음 정정 확인'),
        content: Text(
          '${selections.length}개 상품 선택으로 정정합니다.\n\n'
          '기존 구매와 실제 재고 기록은 당시 상품에 남습니다. 변경된 장보기는 새 활동에서 다시 확인해요.',
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
      'expectedGraphFingerprint': data['graphFingerprint'],
      'selections': selections,
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
      await widget.client.correctShoppingBasket(request);
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
    appBar: AppBar(title: const Text('장보기 재료·상품 정정')),
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
                const Text('재료별 상품, 개수, 한 개의 포장 분량을 함께 확인하세요.'),
                const SizedBox(height: 12),
                for (final raw in (_data!['basket'] as Map)['lines'] as List)
                  ListTile(
                    title: Text((raw as Map)['name'] as String),
                    subtitle: Text('${(raw['choices'] as List).length}개 상품 선택'),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('shopping-basket-correction-edit'),
                  onPressed: _busy || _pending != null ? null : _edit,
                  child: const Text('장보기 묶음 수정'),
                ),
              ],
            ],
          ),
  );
}
