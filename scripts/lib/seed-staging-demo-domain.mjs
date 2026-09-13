const chunk = (rows, size = 500) => Array.from(
  { length: Math.ceil(rows.length / size) },
  (_, index) => rows.slice(index * size, (index + 1) * size),
);

async function insertChunks(tx, table, rows, columns, returning = false) {
  const results = [];
  for (const batch of chunk(rows)) {
    if (batch.length === 0) continue;
    const inserted = returning
      ? await tx`insert into ${tx(table)} ${tx(batch, ...columns)} returning *`
      : await tx`insert into ${tx(table)} ${tx(batch, ...columns)}`;
    results.push(...inserted);
  }
  return results;
}

const scalar = (value) => String(value);
const instantKey = (value) => new Date(value).toISOString();

export async function seedStagingDemoDomain(sql, model) {
  const summary = await sql.begin(async (tx) => {
    await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${model.showcaseUserId}, true)`;
    await tx`set constraints all deferred`;

    const profileRows = model.shooters.map((shooter) => ({
      id: shooter.authId,
      first_name: shooter.firstName,
      last_name: shooter.lastName,
      title: shooter.index % 9 === 0 ? "Dr" : shooter.index % 2 === 0 ? "Mr" : "Ms",
      town: model.organisations.find((organisation) => organisation.key === shooter.organisationKey)
        .clubs.find((club) => club.localKey === shooter.clubKey).town,
      county: model.organisations.find((organisation) => organisation.key === shooter.organisationKey)
        .clubs.find((club) => club.localKey === shooter.clubKey).county,
    }));
    for (const batch of chunk(profileRows)) {
      await tx`
        insert into public.profiles ${tx(batch, "id", "first_name", "last_name", "title", "town", "county")}
        on conflict (id) do update set
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          title = excluded.title,
          town = excluded.town,
          county = excluded.county
      `;
    }

    const organisationRows = model.organisations.map((organisation) => ({
      name: organisation.name, slug: organisation.slug, short_name: organisation.shortName,
      description: organisation.description, website: organisation.website,
      contact_email: organisation.email, status: "active", organisation_type: organisation.type,
      address: organisation.address, postcode: organisation.postcode,
      telephone: organisation.telephone, about_content: organisation.about,
    }));
    const insertedOrganisations = await tx`
      insert into public.organisations ${tx(organisationRows,
        "name", "slug", "short_name", "description", "website", "contact_email", "status",
        "organisation_type", "address", "postcode", "telephone", "about_content")}
      returning id, slug
    `;
    const organisationId = new Map(insertedOrganisations.map((row) => [row.slug, row.id]));
    const organisationIdByKey = new Map(model.organisations.map((organisation) => [
      organisation.key, organisationId.get(organisation.slug),
    ]));

    const shooterByKey = new Map(model.shooters.map((shooter) => [shooter.key, shooter]));
    const organisationActorIdByKey = new Map(model.organisations.map((organisation) => [
      organisation.key,
      (organisation.key === "eastern"
        ? shooterByKey.get("showcase")
        : model.shooters.find((shooter) => shooter.organisationKey === organisation.key)).authId,
    ]));
    const organisationStaff = [];
    for (const organisation of model.organisations) {
      const members = model.shooters.filter((shooter) => shooter.organisationKey === organisation.key);
      const owner = organisation.key === "eastern" ? shooterByKey.get("showcase") : members[0];
      const manager = members.find((shooter) => shooter.key !== owner.key);
      organisationStaff.push(
        { organisation_id: organisationIdByKey.get(organisation.key), user_id: owner.authId, role: "owner", status: "active" },
        { organisation_id: organisationIdByKey.get(organisation.key), user_id: manager.authId, role: "manager", status: "active" },
      );
    }
    await insertChunks(tx, "public.organisation_staff", organisationStaff,
      ["organisation_id", "user_id", "role", "status"]);

    const organisationCards = model.organisations.flatMap((organisation) => organisation.cards.map((card, index) => ({
      organisation_id: organisationIdByKey.get(organisation.key), title: card[0], content: card[1],
      position: index + 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.organisation_information_cards", organisationCards,
      ["organisation_id", "title", "content", "position", "created_by", "updated_by"]);

    const allClubs = model.organisations.flatMap((organisation) => organisation.clubs);
    const clubRows = allClubs.map((club) => ({
      name: club.name, slug: club.slug, town: club.town, county: club.county,
      postcode: club.postcode, website: club.website, status: "active", about_content: club.about,
    }));
    const insertedClubs = await tx`
      insert into public.clubs ${tx(clubRows,
        "name", "slug", "town", "county", "postcode", "website", "status", "about_content")}
      returning id, slug
    `;
    const clubIdBySlug = new Map(insertedClubs.map((row) => [row.slug, row.id]));
    const clubIdByKey = new Map(allClubs.map((club) => [club.key, clubIdBySlug.get(club.slug)]));

    const clubCards = allClubs.map((club) => ({
      club_id: clubIdByKey.get(club.key), title: "Club programme",
      content: `${club.name} publishes practice nights and league team selections through the Club committee.`,
      position: 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    await insertChunks(tx, "public.club_information_cards", clubCards,
      ["club_id", "title", "content", "position", "created_by", "updated_by"]);

    const membershipRows = [];
    for (const organisation of model.organisations) {
      for (const club of organisation.clubs) {
        const members = model.shooters.filter((shooter) => shooter.organisationKey === organisation.key
          && shooter.clubKey === club.localKey);
        for (const [index, shooter] of members.entries()) {
          const role = club.localKey === "basildon" && shooter.showcase ? "owner"
            : index === 0 ? "owner" : index === 1 ? "official" : "member";
          membershipRows.push({
            club_id: clubIdByKey.get(club.key), user_id: shooter.authId,
            status: "active", role,
          });
        }
      }
    }
    const insertedMemberships = await insertChunks(tx, "public.club_memberships", membershipRows,
      ["club_id", "user_id", "status", "role"], "id, club_id, user_id");
    const membershipId = new Map(insertedMemberships.map((row) => [
      `${scalar(row.club_id)}:${row.user_id}`, row.id,
    ]));

    const easternOrganisationId = organisationIdByKey.get("eastern");
    const [customEquipment] = await tx`
      insert into public.organisation_equipment_types
        (organisation_id, display_name, normalized_name, created_by)
      values (${easternOrganisationId}, ${model.customEquipment.name},
        ${model.customEquipment.normalizedName}, ${model.showcaseUserId})
      returning id
    `;
    const [customPosition] = await tx`
      insert into public.organisation_shooting_positions
        (organisation_id, display_name, normalized_name, created_by)
      values (${easternOrganisationId}, ${model.customPosition.name},
        ${model.customPosition.normalizedName}, ${model.showcaseUserId})
      returning id
    `;

    const seasonRows = model.seasons.map((season) => ({
      organisation_id: organisationIdByKey.get(season.organisationKey),
      name: season.name,
      description: `${season.name} provides ten fortnightly rounds across the established inter-club programme.`,
      slug: season.slug, status: season.status, entry_opens_at: season.entryOpensAt,
      entry_closes_at: season.entryClosesAt, starts_at: season.startsAt, ends_at: season.endsAt,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    const insertedSeasons = await insertChunks(tx, "public.league_seasons", seasonRows,
      ["organisation_id", "name", "description", "slug", "status", "entry_opens_at",
        "entry_closes_at", "starts_at", "ends_at", "created_by", "updated_by"],
      "id, organisation_id, slug");
    const seasonId = new Map(insertedSeasons.map((row) => [
      `${scalar(row.organisation_id)}:${row.slug}`, row.id,
    ]));
    const seasonIdByKey = new Map(model.seasons.map((season) => [
      season.key, seasonId.get(`${scalar(organisationIdByKey.get(season.organisationKey))}:${season.slug}`),
    ]));

    const seriesRows = model.series.map((series) => ({
      organisation_id: organisationIdByKey.get(series.organisationKey), name: series.name,
      slug: series.slug, entry_format: series.entryFormat, team_size: series.teamSize,
      sets_per_round: 1, shots_per_round: series.components.reduce((sum, component) => sum + component.shots, 0),
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      shooting_details_version: 1, equipment_type_code: series.equipment,
      organisation_equipment_type_id: series.customEquipment ? customEquipment.id : null,
    }));
    const insertedSeries = await insertChunks(tx, "public.competition_series", seriesRows,
      ["organisation_id", "name", "slug", "entry_format", "team_size", "sets_per_round",
        "shots_per_round", "created_by", "updated_by", "shooting_details_version",
        "equipment_type_code", "organisation_equipment_type_id"], "id, organisation_id, slug");
    const seriesId = new Map(insertedSeries.map((row) => [
      `${scalar(row.organisation_id)}:${row.slug}`, row.id,
    ]));
    const seriesIdByKey = new Map(model.series.map((series) => [
      series.key, seriesId.get(`${scalar(organisationIdByKey.get(series.organisationKey))}:${series.slug}`),
    ]));

    const seriesComponentRows = model.series.flatMap((series) => series.components.map((component, index) => ({
      competition_series_id: seriesIdByKey.get(series.key), position: index + 1,
      short_label: component.label, maximum_score: component.maximum,
      score_method: component.scoreMethod, shooting_position_mode: "fixed",
      shooting_position_code: component.customPosition ? null : component.position,
      organisation_shooting_position_id: component.customPosition ? customPosition.id : null,
      distance_mode: "fixed", distance_value: component.distance,
      distance_unit: component.distanceUnit, shots: component.shots,
    })));
    await insertChunks(tx, "public.competition_series_score_components", seriesComponentRows,
      ["competition_series_id", "position", "short_label", "maximum_score", "score_method",
        "shooting_position_mode", "shooting_position_code", "organisation_shooting_position_id",
        "distance_mode", "distance_value", "distance_unit", "shots"]);

    // Establish organisation-owned Average configuration before editions are
    // attached to their Series. Attaching each edition below then exercises the
    // production copy-on-create default workflow instead of fabricating settings.
    for (const program of model.averagePrograms) {
      const organisationId = organisationIdByKey.get(program.organisationKey);
      await tx`select pg_catalog.set_config(
        'request.jwt.claim.sub', ${organisationActorIdByKey.get(program.organisationKey)}, true
      )`;
      const [{ result: policy }] = await tx`
        select public.create_average_policy(
          ${organisationId}, ${program.policyName}, ${program.strategy},
          ${tx.json(program.configuration)}
        ) as result
      `;
      for (const context of program.contexts) {
        const [{ result: createdContext }] = await tx`
          select public.create_average_context(
            ${organisationId}, ${context.name}, ${context.basisMaximum}
          ) as result
        `;
        for (const localSeriesKey of context.seriesKeys) {
          await tx`
            select public.set_competition_series_average_defaults(
              ${organisationId},
              ${seriesIdByKey.get(`${program.organisationKey}:${localSeriesKey}`)},
              ${createdContext.id}, ${policy.version_id}
            )
          `;
        }
      }
    }
    await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${model.showcaseUserId}, true)`;

    const competitionRows = model.competitions.map((competition) => ({
      league_season_id: seasonIdByKey.get(competition.seasonKey), name: competition.name,
      slug: competition.slug,
      description: competition.oneOff
        ? "A standalone Dewar-style open match over two established distances."
        : `${competition.name} edition for ${model.seasons.find((season) => season.key === competition.seasonKey).name}.`,
      status: "draft", entry_format: competition.entryFormat, team_size: competition.teamSize,
      scoring_method: "points_scored",
      maximum_score_per_round: competition.components.reduce((sum, component) => sum + component.maximum, 0),
      shots_per_round: competition.components.reduce((sum, component) => sum + component.shots, 0),
      uses_x_score: competition.usesX, number_of_rounds: 10, entry_fee: competition.fee,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      entry_window_mode: "season_default", start_date_mode: "season_default",
      sets_per_round: competition.setsPerRound, ranking_method: competition.ranking,
      best_rounds_count: competition.bestRounds, local_scoring_enabled: true,
      competition_series_id: null,
      shooting_details_version: 1, equipment_type_code: competition.equipment,
      organisation_equipment_type_id: competition.customEquipment ? customEquipment.id : null,
    }));
    const insertedCompetitions = await insertChunks(tx, "public.competitions", competitionRows,
      ["league_season_id", "name", "slug", "description", "status", "entry_format", "team_size",
        "scoring_method", "maximum_score_per_round", "shots_per_round", "uses_x_score",
        "number_of_rounds", "entry_fee", "created_by", "updated_by", "entry_window_mode",
        "start_date_mode", "sets_per_round", "ranking_method", "best_rounds_count",
        "local_scoring_enabled", "competition_series_id", "shooting_details_version",
        "equipment_type_code", "organisation_equipment_type_id"], "id, league_season_id, slug");
    const competitionId = new Map(insertedCompetitions.map((row) => [
      `${scalar(row.league_season_id)}:${row.slug}`, row.id,
    ]));
    const competitionIdByKey = new Map(model.competitions.map((competition) => [
      competition.key, competitionId.get(`${scalar(seasonIdByKey.get(competition.seasonKey))}:${competition.slug}`),
    ]));

    const roundRows = model.competitions.flatMap((competition) => competition.rounds.map((round) => ({
      competition_id: competitionIdByKey.get(competition.key), round_number: round.number,
      deadline: round.deadline, shoot_by_date: round.shootByDate,
    })));
    const insertedRounds = await insertChunks(tx, "public.competition_rounds", roundRows,
      ["competition_id", "round_number", "deadline", "shoot_by_date"],
      "id, competition_id, round_number");
    const roundId = new Map(insertedRounds.map((row) => [
      `${scalar(row.competition_id)}:${row.round_number}`, row.id,
    ]));
    const roundIdByKey = new Map(model.competitions.flatMap((competition) => competition.rounds.map((round) => [
      `${competition.key}:${round.number}`,
      roundId.get(`${scalar(competitionIdByKey.get(competition.key))}:${round.number}`),
    ])));

    const competitionComponentRows = model.competitions.flatMap((competition) => competition.components.map((component, index) => ({
      competition_id: competitionIdByKey.get(competition.key), position: index + 1,
      short_label: component.label, maximum_score: component.maximum,
      score_method: component.scoreMethod, shooting_position_mode: "fixed",
      shooting_position_code: component.customPosition ? null : component.position,
      organisation_shooting_position_id: component.customPosition ? customPosition.id : null,
      distance_mode: "fixed", distance_value: component.distance,
      distance_unit: component.distanceUnit, shots: component.shots,
    })));
    await insertChunks(tx, "public.competition_score_components", competitionComponentRows,
      ["competition_id", "position", "short_label", "maximum_score", "score_method",
        "shooting_position_mode", "shooting_position_code", "organisation_shooting_position_id",
        "distance_mode", "distance_value", "distance_unit", "shots"]);

    // The real continuation workflow attaches the Series after creating the
    // draft. That update copies the Series Average defaults to each edition.
    for (const competition of model.competitions.filter((item) => item.seriesKey)) {
      await tx`
        update public.competitions
        set competition_series_id = ${seriesIdByKey.get(competition.seriesKey)},
            updated_by = ${model.showcaseUserId}
        where id = ${competitionIdByKey.get(competition.key)}
      `;
    }

    await tx`
      update public.competitions
      set status = 'published'
      where status = 'draft' and ranking_method <> 'round_robin'
    `;

    const entryRows = model.participations.map((participation) => ({
      competition_id: competitionIdByKey.get(participation.competitionKey),
      club_id: clubIdByKey.get(participation.clubKey), status: "submitted",
      submitted_at: `${model.seasons.find((season) => season.key === model.competitions
        .find((competition) => competition.key === participation.competitionKey).seasonKey).entryClosesAt}T12:00:00Z`,
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    }));
    const insertedEntries = await insertChunks(tx, "public.club_competition_entries", entryRows,
      ["competition_id", "club_id", "status", "submitted_at", "created_by", "updated_by"],
      "id, competition_id, club_id");
    const entryId = new Map(insertedEntries.map((row) => [
      `${scalar(row.competition_id)}:${scalar(row.club_id)}`, row.id,
    ]));
    const entryIdByKey = new Map(model.participations.map((participation) => [
      participation.key,
      entryId.get(`${scalar(competitionIdByKey.get(participation.competitionKey))}:${scalar(clubIdByKey.get(participation.clubKey))}`),
    ]));

    const entrantRows = model.participations.flatMap((participation) => participation.entrants.map((entrant) => ({
      club_competition_entry_id: entryIdByKey.get(participation.key), position: entrant.position,
    })));
    const insertedEntrants = await insertChunks(tx, "public.competition_entrants", entrantRows,
      ["club_competition_entry_id", "position"], "id, club_competition_entry_id, position");
    const entrantId = new Map(insertedEntrants.map((row) => [
      `${scalar(row.club_competition_entry_id)}:${row.position}`, row.id,
    ]));
    const entrantIdByKey = new Map(model.participations.flatMap((participation) => participation.entrants.map((entrant) => [
      entrant.key, entrantId.get(`${scalar(entryIdByKey.get(participation.key))}:${entrant.position}`),
    ])));

    const participantRows = [];
    const participantKeyByIdentity = new Map();
    for (const participation of model.participations) {
      const clubId = clubIdByKey.get(participation.clubKey);
      for (const entrant of participation.entrants) {
        for (const member of entrant.members) {
          const shooter = shooterByKey.get(member.shooterKey);
          participantRows.push({
            club_competition_entry_id: entryIdByKey.get(participation.key),
            competition_entrant_id: entrantIdByKey.get(entrant.key),
            club_membership_id: membershipId.get(`${scalar(clubId)}:${shooter.authId}`),
            slot_number: member.slot,
          });
          participantKeyByIdentity.set(
            `${scalar(entrantIdByKey.get(entrant.key))}:${shooter.authId}`,
            `${entrant.key}:${shooter.key}`,
          );
        }
      }
    }
    const insertedParticipants = await insertChunks(tx, "public.competition_entrant_participants", participantRows,
      ["club_competition_entry_id", "competition_entrant_id", "club_membership_id", "slot_number"],
      "id, competition_entrant_id, club_membership_id");
    const participantIdByKey = new Map();
    for (const row of insertedParticipants) {
      const membership = insertedMemberships.find((item) => scalar(item.id) === scalar(row.club_membership_id));
      const key = participantKeyByIdentity.get(`${scalar(row.competition_entrant_id)}:${membership.user_id}`);
      participantIdByKey.set(key, row.id);
    }

    const currentProneKey = "eastern:summer-2026:prone-individual";
    const currentPairsKey = "eastern:summer-2026:prone-pairs";
    const divisionCompetitionKeys = model.competitions
      .filter((competition) => !competition.oneOff
        && (competition.organisationKey === "eastern" || competition.templateKey !== "gallery-rifle"))
      .map((competition) => competition.key);
    const divisionAllocationsByCompetition = new Map();
    for (const key of divisionCompetitionKeys) {
      const entrantKeys = model.participations.filter((item) => item.competitionKey === key)
        .flatMap((item) => item.entrants.map((entrant) => entrant.key));
      const entrantCount = entrantKeys.length;
      const count = key.startsWith("eastern:") ? Math.min(entrantCount, entrantCount >= 16 ? 4 : 3) : 2;
      divisionAllocationsByCompetition.set(key, Array.from({ length: count }, (_, index) => ({
        name: `Division ${index + 1}`,
        entrant_ids: entrantKeys.filter((_, entrantIndex) => entrantIndex % count === index)
          .map((entrantKey) => entrantIdByKey.get(entrantKey)),
      })));
    }

    const roundRobinCompetitionKeys = divisionCompetitionKeys.filter((item) => (
      model.competitions.find((competition) => competition.key === item).ranking === "round_robin"
    ));
    // Historical Round Robin schedules cannot be generated after their Start.
    // Recreate the original pre-Start publication moment locally, using the
    // production draft writer and the fixture-generation trigger. The canonical
    // Start is restored as soon as the immutable schedule exists.
    for (const key of roundRobinCompetitionKeys) {
      const competition = model.competitions.find((item) => item.key === key);
      const season = model.seasons.find((item) => item.key === competition.seasonKey);
      const organisationId = organisationIdByKey.get(competition.organisationKey);
      const competitionId = competitionIdByKey.get(key);
      await tx`select pg_catalog.set_config(
        'request.jwt.claim.sub', ${organisationActorIdByKey.get(competition.organisationKey)}, true
      )`;
      await tx`
        select public.save_competition_division_draft(
          ${organisationId}, ${seasonIdByKey.get(competition.seasonKey)}, ${competitionId},
          ${competition.organisationKey === "eastern" ? 6 : 5},
          ${tx.json(divisionAllocationsByCompetition.get(key))}
        )
      `;
      await tx`
        update public.competitions
        set start_date_mode = 'custom', custom_starts_at = '2099-01-01', status = 'published'
        where id = ${competitionId}
      `;
      if (season.entryClosesAt < model.asOfDate) {
        await tx`
          update public.competition_division_configs
          set status = 'published', published_at = clock_timestamp()
          where competition_id = ${competitionId}
        `;
      }
      if (key !== currentPairsKey) {
        await tx`
          update public.competitions
          set start_date_mode = 'season_default', custom_starts_at = null
          where id = ${competitionId}
        `;
      }
    }
    await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${model.showcaseUserId}, true)`;

    const currentSeasonId = seasonIdByKey.get("eastern:summer-2026");
    const [concurrentGroup] = await tx`
      insert into public.concurrent_shooting_groups
        (organisation_id, league_season_id, name, status, created_by, updated_by)
      values (${easternOrganisationId}, ${currentSeasonId},
        'Summer Prone Shared Cards', 'draft', ${model.showcaseUserId}, ${model.showcaseUserId})
      returning id
    `;
    await tx`
      insert into public.concurrent_shooting_group_competitions
        (concurrent_shooting_group_id, competition_id, created_by)
      values
        (${concurrentGroup.id}, ${competitionIdByKey.get(currentProneKey)}, ${model.showcaseUserId}),
        (${concurrentGroup.id}, ${competitionIdByKey.get(currentPairsKey)}, ${model.showcaseUserId})
    `;
    const physicalRounds = await insertChunks(tx, "public.concurrent_shooting_rounds",
      Array.from({ length: 10 }, (_, index) => ({
        concurrent_shooting_group_id: concurrentGroup.id, position: index + 1,
        label: `Round ${index + 1}`, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      })), ["concurrent_shooting_group_id", "position", "label", "created_by", "updated_by"],
      "id, position");
    const physicalRoundId = new Map(physicalRounds.map((row) => [row.position, row.id]));
    const mappingRows = physicalRounds.flatMap((physicalRound) => [currentProneKey, currentPairsKey].map((key) => ({
      concurrent_shooting_group_id: concurrentGroup.id,
      concurrent_shooting_round_id: physicalRound.id,
      competition_id: competitionIdByKey.get(key),
      competition_round_id: roundIdByKey.get(`${key}:${physicalRound.position}`),
      created_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.concurrent_shooting_round_mappings", mappingRows,
      ["concurrent_shooting_group_id", "concurrent_shooting_round_id", "competition_id",
        "competition_round_id", "created_by"]);
    // Reconstruct an already-active current group through the real V2
    // activation RPC while both members temporarily share a future Start.
    await tx`
      update public.competitions
      set start_date_mode = 'custom', custom_starts_at = '2099-01-01'
      where id = ${competitionIdByKey.get(currentProneKey)}
    `;
    await tx`
      select public.activate_concurrent_shooting_group(
        ${easternOrganisationId}, ${concurrentGroup.id}
      )
    `;
    await tx`
      update public.competitions
      set start_date_mode = 'season_default', custom_starts_at = null
      where id in ${tx([
        competitionIdByKey.get(currentProneKey),
        competitionIdByKey.get(currentPairsKey),
      ])}
    `;

    const sourceRows = model.scores.map((source) => ({
      shooter_profile_id: shooterByKey.get(source.shooterKey).authId,
      concurrent_shooting_round_id: source.concurrent ? physicalRoundId.get(source.roundNumber) : null,
      version: 1, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
      created_at: source.occurredAt,
      updated_at: source.occurredAt,
    }));
    const insertedSources = await insertChunks(tx, "public.shooting_score_sources", sourceRows,
      ["shooter_profile_id", "concurrent_shooting_round_id", "version", "created_by", "updated_by",
        "created_at", "updated_at"], "id, created_at");
    const sourceIdByInstant = new Map(insertedSources.map((row) => [instantKey(row.created_at), row.id]));
    const sourceIdByKey = new Map(model.scores.map((source) => [
      source.key, sourceIdByInstant.get(source.occurredAt),
    ]));

    const usageRows = model.scores.flatMap((source) => source.usages.map((usage) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key),
      competition_id: competitionIdByKey.get(usage.competitionKey),
      competition_round_id: roundIdByKey.get(`${usage.competitionKey}:${usage.roundNumber}`),
      competition_entrant_participant_id: participantIdByKey.get(`${usage.entrantKey}:${usage.shooterKey}`),
      created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.competition_score_usages", usageRows,
      ["shooting_score_source_id", "competition_id", "competition_round_id",
        "competition_entrant_participant_id", "created_by", "updated_by"]);

    // The canonical score-value guard requires a source to have at least one
    // legitimate Competition usage. Usages may be attached before values and
    // validate every value again as those canonical ACHIEVED rows arrive.
    const valueRows = model.scores.flatMap((source) => source.values.map((value) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key), set_number: value.setNumber,
      component_position: value.componentPosition, achieved_score: value.achieved,
      x_count: value.xCount, created_by: model.showcaseUserId, updated_by: model.showcaseUserId,
    })));
    await insertChunks(tx, "public.shooting_score_values", valueRows,
      ["shooting_score_source_id", "set_number", "component_position", "achieved_score",
        "x_count", "created_by", "updated_by"]);

    const concurrentEvents = model.scores.filter((source) => source.concurrent).map((source) => ({
      shooting_score_source_id: sourceIdByKey.get(source.key), actor_id: model.showcaseUserId,
      origin_competition_id: competitionIdByKey.get(source.usages[0].competitionKey),
      origin_competition_round_id: roundIdByKey.get(`${source.usages[0].competitionKey}:${source.roundNumber}`),
      operation: "create",
    }));
    for (const batch of chunk(concurrentEvents)) {
      await tx`
        insert into public.shooting_score_change_events (
          shooting_score_source_id, actor_id, origin_competition_id,
          origin_competition_round_id, operation, before_state, after_state
        )
        select event.shooting_score_source_id, event.actor_id,
          event.origin_competition_id, event.origin_competition_round_id,
          event.operation, null,
          private.shooting_score_source_state(event.shooting_score_source_id)
        from jsonb_to_recordset(${tx.json(batch)}) as event (
          shooting_score_source_id bigint,
          actor_id uuid,
          origin_competition_id bigint,
          origin_competition_round_id bigint,
          operation text
        )
      `;
    }

    const configuredSeriesKeys = new Set(model.averagePrograms.flatMap((program) => (
      program.contexts.flatMap((context) => context.seriesKeys.map((seriesKey) => (
        `${program.organisationKey}:${seriesKey}`
      )))
    )));
    const divisionCompetitionKeySet = new Set(divisionCompetitionKeys);
    const roundRobinCompetitionKeySet = new Set(roundRobinCompetitionKeys);

    // Scores carry their historical Round timestamps, while the resolver also
    // enforces each target edition's effective Start. Processing editions in
    // season order therefore recreates the real calculate/finalise progression:
    // first editions resolve to no_history, and later editions use only earlier
    // compatible released canonical scores.
    const lifecycleCompetitions = [...model.competitions].sort((left, right) => (
      left.seasonIndex - right.seasonIndex
      || model.competitions.indexOf(left) - model.competitions.indexOf(right)
    ));
    for (const competition of lifecycleCompetitions) {
      const organisationId = organisationIdByKey.get(competition.organisationKey);
      const competitionId = competitionIdByKey.get(competition.key);
      const seasonId = seasonIdByKey.get(competition.seasonKey);
      const season = model.seasons.find((item) => item.key === competition.seasonKey);
      const usesAverages = configuredSeriesKeys.has(competition.seriesKey);
      const usesDivisions = divisionCompetitionKeySet.has(competition.key);
      const isRoundRobin = roundRobinCompetitionKeySet.has(competition.key);
      const readyToFinalise = season.entryClosesAt < model.asOfDate;

      await tx`select pg_catalog.set_config(
        'request.jwt.claim.sub', ${organisationActorIdByKey.get(competition.organisationKey)}, true
      )`;

      if (usesAverages) {
        await tx`
          select public.calculate_competition_starting_averages(
            ${organisationId}, ${seasonId}, ${competitionId}
          )
        `;
      }

      if (usesDivisions) {
        const allocation = divisionAllocationsByCompetition.get(competition.key);
        const targetSize = competition.organisationKey === "eastern" ? 6 : 5;
        if (isRoundRobin && usesAverages) {
          const [{ projection }] = await tx`
            select public.get_competition_division_average_projection(
              ${organisationId}, ${seasonId}, ${competitionId}
            ) as projection
          `;
          if (readyToFinalise) {
            // The immutable historical Round Robin schedule was reconstructed
            // before its real Start above. Complete the same reviewed freeze
            // internals used by Division publication without reshuffling it.
            await tx`
              select private.record_competition_starting_average_review(
                ${competitionId}, ${projection.current_fingerprint},
                ${organisationActorIdByKey.get(competition.organisationKey)}
              )
            `;
            await tx`
              select * from private.freeze_competition_starting_averages(
                ${competitionId},
                ${organisationActorIdByKey.get(competition.organisationKey)}, true
              )
            `;
          } else {
            await tx`
              select public.save_competition_division_draft_with_average_review(
                ${organisationId}, ${seasonId}, ${competitionId}, ${targetSize},
                ${tx.json(allocation)}, ${projection.current_fingerprint}
              )
            `;
          }
        } else if (!isRoundRobin) {
          if (usesAverages) {
            const [{ projection }] = await tx`
              select public.get_competition_division_average_projection(
                ${organisationId}, ${seasonId}, ${competitionId}
              ) as projection
            `;
            await tx`
              select public.save_competition_division_draft_with_average_review(
                ${organisationId}, ${seasonId}, ${competitionId}, ${targetSize},
                ${tx.json(allocation)}, ${projection.current_fingerprint}
              )
            `;
          } else {
            await tx`
              select public.save_competition_division_draft(
                ${organisationId}, ${seasonId}, ${competitionId}, ${targetSize},
                ${tx.json(allocation)}
              )
            `;
          }
          if (readyToFinalise) {
            await tx`
              select public.publish_competition_divisions(
                ${organisationId}, ${seasonId}, ${competitionId}
              )
            `;
          }
        }
      } else if (usesAverages && readyToFinalise) {
        await tx`
          select public.finalise_competition_starting_averages(
            ${organisationId}, ${seasonId}, ${competitionId}
          )
        `;
      }
    }
    await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${model.showcaseUserId}, true)`;

    // Recompute continuation provenance after all transaction-local lifecycle
    // dates are restored so each version describes the committed edition.
    for (const series of model.series) {
      const editions = model.competitions.filter((competition) => competition.seriesKey === series.key)
        .sort((left, right) => left.seasonIndex - right.seasonIndex);
      for (let index = 1; index < editions.length; index += 1) {
        const currentId = competitionIdByKey.get(editions[index].key);
        const previousId = competitionIdByKey.get(editions[index - 1].key);
        const [{ version }] = await tx`
          select private.competition_configuration_version(${previousId}) as version
        `;
        await tx`
          update public.competitions
          set configuration_source_competition_id = ${previousId},
              configuration_source_version = ${version}
          where id = ${currentId}
        `;
      }
    }

    const showcaseAnalytics = await tx`
      select public.get_my_shooter_analytics() as payload
    `;
    const payload = showcaseAnalytics[0].payload;
    const counts = (await tx`
      select
        (select count(*)::integer from public.organisations) as organisations,
        (select count(*)::integer from public.clubs) as clubs,
        (select count(*)::integer from public.profiles) as shooters,
        (select count(*)::integer from public.league_seasons) as seasons,
        (select count(*)::integer from public.competition_series) as series,
        (select count(*)::integer from public.competitions) as competitions,
        (select count(*)::integer from public.competition_rounds) as rounds,
        (select count(*)::integer from public.club_competition_entries) as entries,
        (select count(*)::integer from public.competition_entrants) as entrants,
        (select count(*)::integer from public.competition_entrant_participants) as participants,
        (select count(*)::integer from public.shooting_score_sources) as sources,
        (select count(*)::integer from public.shooting_score_values) as values,
        (select count(*)::integer from public.competition_score_usages) as usages,
        (select count(*)::integer from public.concurrent_shooting_groups) as concurrent_groups,
        (select count(*)::integer from public.average_contexts) as average_contexts,
        (select count(*)::integer from public.average_policies) as average_policies,
        (select count(*)::integer from public.average_policy_versions) as average_policy_versions,
        (select count(*)::integer from public.competition_series_average_defaults) as series_average_defaults,
        (select count(*)::integer from public.competition_average_settings) as competition_average_settings,
        (select count(*)::integer from public.competition_participant_starting_averages) as starting_average_snapshots,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'frozen') as frozen_starting_averages,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'frozen' and starting_average is not null) as frozen_starting_average_values,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'frozen' and origin = 'no_history') as frozen_no_history_snapshots,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'provisional') as provisional_starting_averages,
        (select count(*)::integer from public.competition_starting_average_finalisations) as average_finalisations,
        (select count(*)::integer from public.competition_division_configs
          where status = 'published') as published_division_configs,
        (select count(*)::integer from public.competition_division_configs
          where status = 'draft') as draft_division_configs
    `)[0];

    const fail = (condition, message) => { if (condition) throw new Error(`Post-seed validation failed: ${message}`); };
    const expectedAverageContexts = model.averagePrograms
      .reduce((sum, program) => sum + program.contexts.length, 0);
    const expectedAverageDefaults = model.averagePrograms.reduce((sum, program) => (
      sum + program.contexts.reduce((contextSum, context) => contextSum + context.seriesKeys.length, 0)
    ), 0);
    const expectedAverageSettings = model.competitions
      .filter((competition) => configuredSeriesKeys.has(competition.seriesKey)).length;
    const expectedMatureAverageCompetitions = model.competitions.filter((competition) => (
      configuredSeriesKeys.has(competition.seriesKey)
      && model.seasons.find((season) => season.key === competition.seasonKey).entryClosesAt < model.asOfDate
    )).length;
    const expectedStartingAverageSnapshots = model.participations
      .filter((participation) => configuredSeriesKeys.has(
        model.competitions.find((competition) => competition.key === participation.competitionKey).seriesKey,
      ))
      .flatMap((participation) => participation.entrants)
      .flatMap((entrant) => entrant.members).length;
    const expectedFrozenStartingAverages = model.participations.filter((participation) => {
      const competition = model.competitions.find((item) => item.key === participation.competitionKey);
      const season = model.seasons.find((item) => item.key === competition.seasonKey);
      return configuredSeriesKeys.has(competition.seriesKey) && season.entryClosesAt < model.asOfDate;
    }).flatMap((participation) => participation.entrants)
      .flatMap((entrant) => entrant.members).length;
    const expectedPublishedDivisionConfigs = model.competitions.filter((competition) => (
      divisionCompetitionKeySet.has(competition.key)
      && model.seasons.find((season) => season.key === competition.seasonKey).entryClosesAt < model.asOfDate
    )).length;
    fail(counts.organisations !== 3, `expected 3 Organisations, found ${counts.organisations}`);
    fail(counts.clubs !== 15, `expected 15 Clubs, found ${counts.clubs}`);
    fail(counts.shooters !== 96, `expected 96 shooters, found ${counts.shooters}`);
    fail(counts.seasons !== 18 || counts.competitions !== 91 || counts.rounds !== 910,
      "Season, Competition, or Round totals are incorrect");
    fail(counts.entries !== model.participations.length
      || counts.entrants !== model.participations.flatMap((item) => item.entrants).length
      || counts.participants !== model.participations.flatMap((item) => item.entrants)
        .flatMap((item) => item.members).length
      || counts.sources !== model.scores.length
      || counts.values !== model.scores.flatMap((item) => item.values).length
      || counts.usages !== model.scores.flatMap((item) => item.usages).length,
    "entry, participant, or canonical score totals are incorrect");
    fail(counts.average_contexts !== expectedAverageContexts
      || counts.average_policies !== model.averagePrograms.length
      || counts.average_policy_versions !== model.averagePrograms.length,
    "Average Context or versioned Policy totals are incorrect");
    fail(counts.series_average_defaults !== expectedAverageDefaults
      || counts.competition_average_settings !== expectedAverageSettings,
    "Series Average defaults were not copied to every intended edition");
    fail(counts.average_finalisations !== expectedMatureAverageCompetitions,
      `expected ${expectedMatureAverageCompetitions} mature Average finalisations, found ${counts.average_finalisations}`);
    fail(counts.starting_average_snapshots !== expectedStartingAverageSnapshots
      || counts.frozen_starting_averages !== expectedFrozenStartingAverages
      || counts.provisional_starting_averages
        !== expectedStartingAverageSnapshots - expectedFrozenStartingAverages,
    "Starting Average snapshot/frozen/provisional totals are incorrect");
    fail(counts.published_division_configs !== expectedPublishedDivisionConfigs
      || counts.draft_division_configs !== divisionCompetitionKeys.length - expectedPublishedDivisionConfigs,
    "published/draft Division lifecycle totals are incorrect");
    fail(payload.summary.physical_shoot_count < 20, "showcase analytics has fewer than 20 physical shoots");
    fail(payload.chart_points.length !== payload.summary.physical_shoot_count,
      "analytics chart does not deduplicate to one point per physical source");
    fail(new Set([
      payload.summary.best_score_percentage,
      payload.summary.mean_score_percentage,
      payload.summary.recent_score_percentage,
    ]).size !== 3, "showcase Best, Mean, and Recent statistics should differ");
    fail(payload.summary.trend_direction === "unavailable" || payload.recent_scores.length < 1,
      "showcase trend or recent history is missing");
    fail(!payload.chart_points.some((point) => point.components.length > 1),
      "showcase analytics has no multi-component physical result");
    fail(payload.filter_options.seasons.length < 4 || payload.filter_options.equipment.length < 2
      || payload.filter_options.positions.length < 3 || payload.filter_options.distances.length < 3,
    "showcase analytics filters are not meaningfully populated");

    const [integrity] = await tx`
      select
        exists (
          select 1 from public.shooting_score_values value
          join public.shooting_score_sources source on source.id = value.shooting_score_source_id
          join public.competition_score_usages usage on usage.shooting_score_source_id = source.id
          join public.competition_score_components component
            on component.competition_id = usage.competition_id
           and component.position = value.component_position
          where value.achieved_score > component.maximum_score
        ) as score_over_maximum,
        exists (
          select 1 from public.shooting_score_values value
          join public.shooting_score_sources source on source.id = value.shooting_score_source_id
          join public.competition_score_usages usage on usage.shooting_score_source_id = source.id
          join public.competitions competition on competition.id = usage.competition_id
          join public.competition_score_components component
            on component.competition_id = competition.id
           and component.position = value.component_position
          where (not competition.uses_x_score and value.x_count is not null)
             or (competition.uses_x_score and (value.x_count is null or value.x_count > component.shots))
        ) as invalid_x,
        (select count(*)::integer from public.competitions where slug = 'eastern-dewar-open'
          and competition_series_id is null) as one_offs,
        (select count(*)::integer from public.concurrent_shooting_groups
          where status = 'active' and compatibility_version = 2) as active_v2_groups,
        (select count(*)::integer from public.shooting_score_sources source
          where source.shooter_profile_id = ${model.showcaseUserId}
            and (select count(*) from public.competition_score_usages usage
              where usage.shooting_score_source_id = source.id) > 1) as showcase_shared_sources,
        (select count(*)::integer from public.competition_participant_starting_averages
          where status = 'frozen' and origin = 'calculated') as frozen_calculated_averages,
        (select count(*)::integer
          from public.organisation_staff as staff
          join public.organisations as organisation on organisation.id = staff.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and staff.user_id = ${model.showcaseUserId}
            and staff.role = 'owner' and staff.status = 'active') as showcase_organisation_ownerships,
        (select count(*)::integer
          from public.club_memberships as membership
          join public.clubs as club on club.id = membership.club_id
          where club.name = 'Basildon Rifle and Pistol Club'
            and membership.user_id = ${model.showcaseUserId}
            and membership.role = 'owner' and membership.status = 'active') as showcase_club_ownerships,
        (select count(*)::integer
          from public.league_seasons as season
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association') as eastern_seasons,
        (select count(*)::integer
          from public.league_seasons as season
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and ((season.slug = 'summer-2026' and season.status = 'active')
              or (season.slug = 'winter-2026' and season.status = 'open'))) as eastern_current_future_states,
        (select count(*)::integer from public.competition_series as series
          where (select count(distinct competition.league_season_id)
            from public.competitions as competition
            where competition.competition_series_id = series.id) >= 2) as spanning_series,
        (select count(*)::integer from public.competitions as competition
          where (select count(*) from public.competition_rounds as round
            where round.competition_id = competition.id) <> 10) as bad_round_counts,
        (select count(*)::integer from public.competition_rounds
          where deadline < current_date) as released_rounds,
        (select count(*)::integer from public.competition_rounds
          where deadline >= current_date) as unreleased_rounds,
        (select count(*)::integer from public.average_policy_versions
          where strategy = 'current_then_preceding') as current_then_preceding_policies,
        (select count(*)::integer
          from public.competition_series_average_defaults defaults
          join public.average_policy_versions version
            on version.id = defaults.average_policy_version_id
          where version.strategy = 'current_then_preceding') as current_then_preceding_defaults,
        (select count(*)::integer
          from public.competition_average_settings setting
          join public.average_policy_versions version
            on version.id = setting.average_policy_version_id
          where version.strategy = 'current_then_preceding') as current_then_preceding_settings,
        (select count(*)::integer from (
          select configuration.average_context_id
          from (
            select setting.average_context_id,
              jsonb_build_object(
                'equipment_type_code', competition.equipment_type_code,
                'organisation_equipment_type_id', competition.organisation_equipment_type_id,
                'sets_per_round', competition.sets_per_round,
                'uses_x_score', competition.uses_x_score,
                'components', (
                  select jsonb_agg(jsonb_build_object(
                    'position', component.position,
                    'maximum_score', component.maximum_score,
                    'score_method', component.score_method,
                    'shooting_position_mode', component.shooting_position_mode,
                    'shooting_position_code', component.shooting_position_code,
                    'organisation_shooting_position_id', component.organisation_shooting_position_id,
                    'distance_mode', component.distance_mode,
                    'distance_value', component.distance_value,
                    'distance_unit', component.distance_unit,
                    'shots', component.shots
                  ) order by component.position)
                  from public.competition_score_components component
                  where component.competition_id = competition.id
                )
              ) as structured_signature
            from public.competition_average_settings setting
            join public.competitions competition on competition.id = setting.competition_id
          ) configuration
          group by configuration.average_context_id
          having count(distinct configuration.structured_signature) > 1
        ) mixed) as incompatible_structured_contexts,
        (select count(*)::integer
          from public.competition_average_settings setting
          join public.average_contexts context on context.id = setting.average_context_id
          where private.competition_average_shooter_maximum(setting.competition_id)
            is distinct from context.basis_maximum) as incompatible_score_bases,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          where snapshot.origin = 'calculated'
            and snapshot.qualifying_score_count <> (
              select count(*) from public.starting_average_score_sources source
              where source.starting_average_id = snapshot.id
            )) as calculated_provenance_mismatches,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          where snapshot.origin = 'manual') as manually_supplied_starting_averages,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          join public.competitions target on target.id = snapshot.competition_id
          join public.competitions source on source.id = snapshot.source_competition_id
          cross join lateral private.get_competition_effective_dates(target.id) target_dates
          cross join lateral private.get_competition_effective_dates(source.id) source_dates
          where snapshot.origin = 'calculated'
            and source_dates.effective_starts_at >= target_dates.effective_starts_at
        ) as nonchronological_starting_averages,
        (select count(*)::integer
          from information_schema.columns
          where table_schema = 'public' and column_name = 'running_average') as persisted_running_average_columns,
        (select count(*)::integer
          from jsonb_array_elements((public.get_competition_result_averages(
            ${easternOrganisationId}, ${seasonIdByKey.get("eastern:summer-2026")},
            ${competitionIdByKey.get(currentProneKey)}
          )->'participants')) participant
          where participant->>'running_average' is not null) as current_running_average_values,
        (select count(distinct competition.competition_series_id)::integer
          from public.competition_participant_starting_averages snapshot
          join public.competitions competition on competition.id = snapshot.competition_id
          where snapshot.shooter_profile_id = ${model.showcaseUserId}
            and snapshot.status = 'frozen' and snapshot.starting_average is not null
        ) as showcase_frozen_average_series,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          join public.competitions competition on competition.id = snapshot.competition_id
          join public.league_seasons season on season.id = competition.league_season_id
          where season.slug = 'summer-2026' and snapshot.status = 'frozen'
            and snapshot.starting_average is not null) as current_frozen_average_values,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          join public.competitions competition on competition.id = snapshot.competition_id
          join public.league_seasons season on season.id = competition.league_season_id
          where season.slug = 'summer-2026' and snapshot.status = 'frozen'
            and snapshot.origin = 'no_history' and snapshot.starting_average is null
        ) as current_frozen_no_history,
        (select count(*)::integer
          from public.competition_participant_starting_averages snapshot
          join public.competitions competition on competition.id = snapshot.competition_id
          join public.league_seasons season on season.id = competition.league_season_id
          where snapshot.shooter_profile_id = ${shooterByKey.get("eastern-31").authId}
            and snapshot.status = 'frozen' and snapshot.origin = 'no_history'
            and season.slug = 'summer-2026' and competition.slug = 'three-position'
        ) as deliberate_first_time_nulls,
        (select count(*)::integer
          from public.competition_division_configs config
          join public.competitions competition on competition.id = config.competition_id
          join public.league_seasons season on season.id = competition.league_season_id
          join public.organisations organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and competition.slug = 'prone-individual') as eastern_prone_division_configs,
        (select count(*)::integer from public.competitions
          where organisation_equipment_type_id = ${customEquipment.id}) as custom_equipment_editions,
        (select count(*)::integer from public.competition_score_components
          where organisation_shooting_position_id = ${customPosition.id}) as custom_position_components,
        (select count(*)::integer
          from public.competitions as competition
          join public.league_seasons as season on season.id = competition.league_season_id
          join public.organisations as organisation on organisation.id = season.organisation_id
          where organisation.name = 'Eastern Region Shooting Association'
            and season.slug = 'summer-2026') as eastern_summer_2026_competitions,
        (select count(*)::integer
          from public.competition_score_usages as usage
          join public.competition_rounds as round on round.id = usage.competition_round_id
          where round.deadline >= current_date) as unreleased_score_usages,
        (select count(*)::integer from (
          select source.shooter_profile_id, source.concurrent_shooting_round_id
          from public.shooting_score_sources as source
          where source.concurrent_shooting_round_id is not null
          group by source.shooter_profile_id, source.concurrent_shooting_round_id
          having count(*) > 1
        ) as duplicates) as duplicate_concurrent_sources,
        (select count(*)::integer from public.concurrent_shooting_round_mappings
          where concurrent_shooting_group_id = (
            select id from public.concurrent_shooting_groups limit 1
          )) as concurrent_round_mappings,
        (select count(*)::integer from public.shooting_score_change_events as event
          where event.operation <> 'create'
            or event.before_state is not null
            or jsonb_typeof(event.after_state) <> 'object'
            or event.after_state is distinct from
              private.shooting_score_source_state(event.shooting_score_source_id)
        ) as invalid_concurrent_audit_events,
        (select count(distinct source.id)::integer
          from public.shooting_score_sources as source
          join public.competition_score_usages as usage
            on usage.shooting_score_source_id = source.id
          join public.competition_rounds as round
            on round.id = usage.competition_round_id
          where source.created_at::date <> round.deadline
            or source.updated_at <> source.created_at
        ) as implausible_source_timestamps
    `;
    fail(integrity.score_over_maximum || integrity.invalid_x, "score bounds or X-count rules failed");
    fail(integrity.one_offs !== 1, "Eastern Dewar Open is not a unique unlinked One-off");
    fail(integrity.active_v2_groups !== 1 || integrity.showcase_shared_sources < 1,
      "Concurrent V2 shared-source example is invalid");
    fail(integrity.frozen_calculated_averages < 1, "no calculated Starting Average was frozen");
    fail(integrity.showcase_organisation_ownerships !== 1 || integrity.showcase_club_ownerships !== 1,
      "showcase user does not own Eastern Region and Basildon");
    fail(integrity.eastern_seasons !== 6 || integrity.eastern_current_future_states !== 2,
      "Eastern Season history or current/upcoming state is incorrect");
    fail(integrity.spanning_series !== counts.series, "not every recurring Series spans Seasons");
    fail(integrity.bad_round_counts !== 0 || integrity.released_rounds < 1 || integrity.unreleased_rounds < 1,
      "Round counts or released/unreleased chronology is invalid");
    fail(integrity.current_then_preceding_policies !== model.averagePrograms.length
      || integrity.current_then_preceding_defaults !== expectedAverageDefaults
      || integrity.current_then_preceding_settings !== expectedAverageSettings
      || integrity.custom_equipment_editions < 2
      || integrity.custom_position_components < 2,
    "Average policy or reusable custom taxonomy fixture is missing");
    fail(integrity.incompatible_structured_contexts !== 0
      || integrity.incompatible_score_bases !== 0,
    "an Average Context mixes incompatible structured shooting or score-basis configurations");
    fail(integrity.calculated_provenance_mismatches !== 0
      || integrity.nonchronological_starting_averages !== 0
      || integrity.manually_supplied_starting_averages !== 0,
    "Starting Averages did not come from canonical chronological calculation provenance");
    fail(integrity.persisted_running_average_columns !== 0
      || integrity.current_running_average_values < 1,
    "Running Average is not being derived from released canonical result scores");
    fail(integrity.showcase_frozen_average_series < 4,
      "showcase shooter does not have frozen S/Av across four recurring Series");
    fail(integrity.current_frozen_average_values < 1
      || integrity.current_frozen_no_history < 1
      || integrity.deliberate_first_time_nulls !== 1,
    "current mature editions do not contain both real S/Av values and a deliberate no-history entrant");
    fail(integrity.current_frozen_average_values <= integrity.current_frozen_no_history,
      "current mature editions are dominated by missing Starting Averages");
    fail(integrity.eastern_prone_division_configs !== 6,
      "every Eastern prone-individual edition should now have a Division configuration");
    fail(integrity.eastern_summer_2026_competitions !== 6 || integrity.unreleased_score_usages !== 0,
      "Eastern Summer 2026 Competition count or unreleased-score exclusion is invalid");
    fail(integrity.duplicate_concurrent_sources !== 0 || integrity.concurrent_round_mappings !== 20,
      "Concurrent physical source uniqueness or explicit Round mappings are invalid");
    fail(integrity.invalid_concurrent_audit_events !== 0,
      "Concurrent audit events do not match canonical source state");
    fail(integrity.implausible_source_timestamps !== 0,
      "score source timestamps do not match Competition Round history");

    for (const dropout of model.dropoutCases) {
      const shooter = shooterByKey.get(dropout.shooterKey);
      const competitionId = competitionIdByKey.get(dropout.competitionKey);
      const [{ scored, zeros }] = await tx`
        select count(distinct usage.competition_round_id)::integer as scored,
          count(*) filter (where value.achieved_score = 0)::integer as zeros
        from public.competition_score_usages usage
        join public.shooting_score_sources source on source.id = usage.shooting_score_source_id
        join public.shooting_score_values value on value.shooting_score_source_id = source.id
        where usage.competition_id = ${competitionId}
          and source.shooter_profile_id = ${shooter.authId}
      `;
      fail(scored !== 4 || zeros !== 0, `dropout case ${dropout.competitionKey} is not four scored Rounds followed by missing scores`);
    }

    return { ...counts, showcaseStatistics: payload.summary, integrity };
  });
  return summary;
}
