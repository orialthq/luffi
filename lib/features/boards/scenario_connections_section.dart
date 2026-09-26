import 'package:flutter/material.dart';

import '../../data/common_kernel_client.dart';

const _connectionKinds = <String, (String, String, String)>{
  'recipe_shopping': ('recipe', 'shopping', '레시피에 필요한 쇼핑'),
  'recipe_health': ('recipe', 'health', '식사와 운동 계획'),
  'travel_dining': ('travel', 'dining', '여행 중 맛집'),
  'travel_life_tip': ('travel', 'life_tip', '여행 준비 팁'),
  'fashion_beauty': ('fashion', 'beauty', '코디와 뷰티 루틴'),
  'fashion_shopping': ('fashion', 'shopping', '코디를 위한 쇼핑'),
  'beauty_shopping': ('beauty', 'shopping', '뷰티 루틴을 위한 쇼핑'),
  'shopping_life_tip': ('shopping', 'life_tip', '쇼핑과 생활 팁'),
  'health_life_tip': ('health', 'life_tip', '운동과 생활 팁'),
};
const _scenarios = {
  'recipe',
  'dining',
  'fashion',
  'beauty',
  'travel',
  'life_tip',
  'shopping',
  'health',
};

final class ScenarioConnectionsSection extends StatefulWidget {
  const ScenarioConnectionsSection({
    required this.client,
    required this.board,
    required this.onOpenBoard,
    super.key,
  });

  final CommonKernelClient client;
  final KernelJson board;
  final void Function(String activityId) onOpenBoard;

  @override
  State<ScenarioConnectionsSection> createState() =>
      _ScenarioConnectionsSectionState();
}

final class _ScenarioConnectionsSectionState
    extends State<ScenarioConnectionsSection> {
  List<KernelJson> _connections = [];
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  String get _activityId => widget.board['id'] as String;
  String get _scenario => (widget.board['scenario'] as String?) ?? '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final connections = await widget.client.listScenarioConnections(
        _activityId,
      );
      if (mounted) {
        setState(() {
          _connections = connections;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<List<KernelJson>> _candidates() async {
    final boards = <KernelJson>[];
    String? cursor;
    for (var pageCount = 0; pageCount < 20; pageCount++) {
      final page = await widget.client.listBoardsPage(
        limit: 100,
        cursor: cursor,
      );
      boards.addAll(page.boards);
      cursor = page.nextCursor;
      if (cursor == null) return boards;
    }
    throw const CommonKernelException(
      'TOO_MANY_BOARDS',
      '활동이 많아요. 목록을 줄여 다시 시도해 주세요.',
    );
  }

  Future<void> _connect() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final boards = await _candidates();
      if (!mounted) return;
      final choices = <(KernelJson, String, String)>[];
      for (final candidate in boards) {
        if (candidate['id'] == _activityId ||
            candidate['lifecycle'] != 'active' ||
            candidate['currentPlanRevision'] == 0 ||
            _connections.any(
              (link) => link['otherActivityId'] == candidate['id'],
            )) {
          continue;
        }
        final otherScenario = candidate['scenario'];
        if (!_scenarios.contains(otherScenario) || otherScenario == _scenario) {
          continue;
        }
        var added = false;
        for (final entry in _connectionKinds.entries) {
          final (from, to, label) = entry.value;
          if ((_scenario == from && otherScenario == to) ||
              (_scenario == to && otherScenario == from)) {
            choices.add((candidate, entry.key, label));
            added = true;
            break;
          }
        }
        if (!added) {
          choices.add((candidate, 'related', '관련 활동'));
        }
      }
      if (choices.isEmpty) {
        setState(() => _error = '연결 가능한 다른 시나리오 활동이 아직 없어요.');
        return;
      }
      final selected = await showDialog<(KernelJson, String, String)>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('활동 연결'),
          content: SizedBox(
            width: 420,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: choices.length,
              itemBuilder: (context, index) {
                final (candidate, _, label) = choices[index];
                return ListTile(
                  title: Text(candidate['title']?.toString() ?? '활동'),
                  subtitle: Text(label),
                  onTap: () => Navigator.pop(context, choices[index]),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('취소'),
            ),
          ],
        ),
      );
      if (selected == null || !mounted) return;
      final (candidate, kind, _) = selected;
      final currentIsFrom =
          kind == 'related' || _scenario == _connectionKinds[kind]!.$1;
      await widget.client.createScenarioConnection({
        'commandId': newKernelCommandId(),
        'fromActivityId': currentIsFrom ? _activityId : candidate['id'],
        'toActivityId': currentIsFrom ? candidate['id'] : _activityId,
        'kind': kind,
        'confirmed': true,
        'expectedFromRevision': currentIsFrom
            ? widget.board['revision']
            : candidate['revision'],
        'expectedToRevision': currentIsFrom
            ? candidate['revision']
            : widget.board['revision'],
      });
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(KernelJson connection) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.deleteScenarioConnection({
        'commandId': newKernelCommandId(),
        'connectionId': connection['id'],
      });
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    key: const ValueKey('scenario-connections'),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '연결된 활동',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              TextButton.icon(
                onPressed: _busy ? null : _connect,
                icon: const Icon(Icons.add_link),
                label: const Text('연결'),
              ),
            ],
          ),
          const Text('다른 활동을 함께 볼 수 있어요. 연결만으로 구매·방문·실행이 확인되지는 않아요.'),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _error.toString(),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (!_loading && _connections.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('연결된 활동이 없어요.'),
            ),
          for (final connection in _connections)
            ListTile(
              key: ValueKey('scenario-connection-${connection['id']}'),
              contentPadding: EdgeInsets.zero,
              title: Text(connection['otherTitle']?.toString() ?? '연결된 활동'),
              subtitle: Text(
                '${_connectionKinds[connection['kind']]?.$3 ?? '활동 연결'} · '
                '지금 할 일 ${connection['otherReadyTaskCount'] ?? 0}개'
                '${connection['otherSubject'] is Map ? ' · 확정 결과 있음' : ''}',
              ),
              onTap: () =>
                  widget.onOpenBoard(connection['otherActivityId'] as String),
              trailing: IconButton(
                tooltip: '연결 해제',
                icon: const Icon(Icons.link_off),
                onPressed: _busy ? null : () => _delete(connection),
              ),
            ),
        ],
      ),
    ),
  );
}
