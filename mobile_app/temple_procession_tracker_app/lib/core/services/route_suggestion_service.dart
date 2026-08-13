import '../models/route_suggestion.dart';
import '../repositories/route_suggestion_repository.dart';

class RouteSuggestionService {
  final RouteSuggestionRepository _routeSuggestionRepository;

  RouteSuggestionService({
    RouteSuggestionRepository? routeSuggestionRepository,
  }) : _routeSuggestionRepository =
            routeSuggestionRepository ?? RouteSuggestionRepository();

  Future<RouteSuggestion> createSuggestion({
    required String eventId,
    required String groupId,
    required String reason,
    required List<String> suggestedRouteSegmentIds,
  }) async {
    final now = DateTime.now();

    final suggestion = RouteSuggestion(
      id: '${groupId}_${now.millisecondsSinceEpoch}',
      eventId: eventId,
      groupId: groupId,
      reason: reason,
      suggestedRouteSegmentIds: suggestedRouteSegmentIds,
      createdAt: now,
      isAccepted: false,
    );

    await _routeSuggestionRepository.create(suggestion);

    return suggestion;
  }

  Future<void> acceptSuggestion({
    required RouteSuggestion suggestion,
    required String acceptedByUserId,
  }) async {
    final acceptedSuggestion = RouteSuggestion(
      id: suggestion.id,
      eventId: suggestion.eventId,
      groupId: suggestion.groupId,
      reason: suggestion.reason,
      suggestedRouteSegmentIds: suggestion.suggestedRouteSegmentIds,
      createdAt: suggestion.createdAt,
      isAccepted: true,
      acceptedByUserId: acceptedByUserId,
    );

    await _routeSuggestionRepository.update(acceptedSuggestion);
  }

  Stream<List<RouteSuggestion>> watchSuggestionsForEvent(String eventId) {
    return _routeSuggestionRepository.streamByEventId(eventId);
  }

  Stream<List<RouteSuggestion>> watchSuggestionsForGroup(String groupId) {
    return _routeSuggestionRepository.streamByGroupId(groupId);
  }
}