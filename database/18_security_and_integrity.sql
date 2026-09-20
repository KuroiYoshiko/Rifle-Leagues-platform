-- Canonical fresh-install schema: security and integrity.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

alter table only "public"."average_contexts"
  add constraint "average_contexts_pkey" PRIMARY KEY (id);
alter table only "public"."average_policies"
  add constraint "average_policies_pkey" PRIMARY KEY (id);
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_pkey" PRIMARY KEY (id);
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_pkey" PRIMARY KEY (id);
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_pkey" PRIMARY KEY (id);
alter table only "public"."club_memberships"
  add constraint "club_memberships_pkey" PRIMARY KEY (id);
alter table only "public"."club_team_roster_members"
  add constraint "club_team_roster_members_pkey" PRIMARY KEY (club_team_id, "position");
alter table only "public"."club_teams"
  add constraint "club_teams_pkey" PRIMARY KEY (id);
alter table only "public"."clubs"
  add constraint "clubs_pkey" PRIMARY KEY (id);
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_pkey" PRIMARY KEY (competition_id);
alter table only "public"."competition_division_assignments"
  add constraint "competition_division_assignments_pkey" PRIMARY KEY (competition_entrant_id);
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_pkey" PRIMARY KEY (competition_id);
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_pkey" PRIMARY KEY (id);
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_pkey" PRIMARY KEY (id);
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_pkey" PRIMARY KEY (id);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_pkey" PRIMARY KEY (id);
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_pkey" PRIMARY KEY (competition_id, division_id, round_id, match_number);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_pkey" PRIMARY KEY (id);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_pkey" PRIMARY KEY (id);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_pkey" PRIMARY KEY (id);
alter table only "public"."competition_series"
  add constraint "competition_series_pkey" PRIMARY KEY (id);
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defaults_pkey" PRIMARY KEY (competition_series_id);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_pkey" PRIMARY KEY (competition_series_id, "position");
alter table only "public"."competition_starting_average_finalisations"
  add constraint "competition_starting_average_finalisations_pkey" PRIMARY KEY (competition_id);
alter table only "public"."competitions"
  add constraint "competitions_pkey" PRIMARY KEY (id);
alter table only "public"."concurrent_shooting_group_competitions"
  add constraint "concurrent_shooting_group_competitions_pkey" PRIMARY KEY (concurrent_shooting_group_id, competition_id);
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_pkey" PRIMARY KEY (id);
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_pkey" PRIMARY KEY (concurrent_shooting_round_id, competition_id);
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_pkey" PRIMARY KEY (id);
alter table only "public"."league_seasons"
  add constraint "league_seasons_pkey" PRIMARY KEY (id);
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_pkey" PRIMARY KEY (id);
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_pkey" PRIMARY KEY (id);
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_pkey" PRIMARY KEY (id);
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_pkey" PRIMARY KEY (id);
alter table only "public"."organisations"
  add constraint "organisations_pkey" PRIMARY KEY (id);
alter table only "public"."profiles"
  add constraint "profiles_pkey" PRIMARY KEY (id);
alter table only "public"."shooting_equipment_types"
  add constraint "shooting_equipment_types_pkey" PRIMARY KEY (code);
alter table only "public"."shooting_positions"
  add constraint "shooting_positions_pkey" PRIMARY KEY (code);
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_pkey" PRIMARY KEY (id);
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_pkey" PRIMARY KEY (id);
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_pkey" PRIMARY KEY (id);
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_pkey" PRIMARY KEY (id);
alter table only "public"."user_organisations"
  add constraint "user_organisations_pkey" PRIMARY KEY (user_id, organisation_id);
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_average_policy_id_version_number_key" UNIQUE (average_policy_id, version_number);
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_competition_club_unique" UNIQUE (competition_id, club_id);
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_club_position_unique" UNIQUE (club_id, "position") DEFERRABLE;
alter table only "public"."club_memberships"
  add constraint "club_memberships_club_user_unique" UNIQUE (club_id, user_id);
alter table only "public"."club_team_roster_members"
  add constraint "club_team_roster_members_team_membership_unique" UNIQUE (club_team_id, club_membership_id);
alter table only "public"."club_teams"
  add constraint "club_teams_club_display_order_unique" UNIQUE (club_id, display_order);
alter table only "public"."clubs"
  add constraint "clubs_slug_unique" UNIQUE (slug);
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_competition_position_unique" UNIQUE (competition_id, "position");
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_id_competition_unique" UNIQUE (id, competition_id);
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_entrant_slot_unique" UNIQUE (competition_entrant_id, slot_number);
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_entry_membership_unique" UNIQUE (club_competition_entry_id, club_membership_id);
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_entry_position_unique" UNIQUE (club_competition_entry_id, "position");
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_id_entry_unique" UNIQUE (id, club_competition_entry_id);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_start_competition_entrant_participa_key" UNIQUE (competition_entrant_participant_id);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_competition_number_unique" UNIQUE (competition_id, round_number);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_competition_position_unique" UNIQUE (competition_id, "position");
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_competition_slot_unique" UNIQUE (competition_id, competition_round_id, competition_entrant_participant_id);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_source_competition_unique" UNIQUE (shooting_score_source_id, competition_id);
alter table only "public"."competition_series"
  add constraint "competition_series_organisation_id_slug_key" UNIQUE (organisation_id, slug);
alter table only "public"."competitions"
  add constraint "competitions_season_slug_unique" UNIQUE (league_season_id, slug);
alter table only "public"."concurrent_shooting_group_competitions"
  add constraint "concurrent_shooting_group_competitions_competition_unique" UNIQUE (competition_id);
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_competition_round_unique" UNIQUE (competition_round_id);
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_group_position_unique" UNIQUE (concurrent_shooting_group_id, "position");
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_id_group_unique" UNIQUE (id, concurrent_shooting_group_id);
alter table only "public"."league_seasons"
  add constraint "league_seasons_organisation_slug_unique" UNIQUE (organisation_id, slug);
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_org_name_unique" UNIQUE (organisation_id, normalized_name);
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_organisation_position_unique" UNIQUE (organisation_id, "position") DEFERRABLE;
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_org_name_unique" UNIQUE (organisation_id, normalized_name);
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_organisation_user_unique" UNIQUE (organisation_id, user_id);
alter table only "public"."organisations"
  add constraint "organisations_slug_unique" UNIQUE (slug);
alter table only "public"."shooting_equipment_types"
  add constraint "shooting_equipment_types_sort_order_unique" UNIQUE (sort_order);
alter table only "public"."shooting_positions"
  add constraint "shooting_positions_sort_order_unique" UNIQUE (sort_order);
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_source_slot_unique" UNIQUE (shooting_score_source_id, set_number, component_position);
alter table only "public"."average_contexts"
  add constraint "average_contexts_basis_maximum_check" CHECK (basis_maximum >= 0.01 AND basis_maximum <= 1000000::numeric AND basis_maximum = round(basis_maximum, 2));
alter table only "public"."average_contexts"
  add constraint "average_contexts_name_check" CHECK (name = btrim(name) AND char_length(name) >= 2 AND char_length(name) <= 160);
alter table only "public"."average_policies"
  add constraint "average_policies_name_check" CHECK (name = btrim(name) AND char_length(name) >= 2 AND char_length(name) <= 160);
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_strategy_check" CHECK (strategy = ANY (ARRAY['manual'::text, 'current_then_preceding'::text]));
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_version_number_check" CHECK (version_number >= 1 AND version_number <= 1000000);
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_status_value" CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'withdrawn'::text]));
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_submission_time" CHECK (status = 'submitted'::text AND submitted_at IS NOT NULL OR status <> 'submitted'::text AND submitted_at IS NULL);
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_content_value" CHECK (char_length(content) >= 1 AND char_length(content) <= 20000 AND content = btrim(content));
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_position_value" CHECK ("position" >= 1 AND "position" <= 5);
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_title_value" CHECK (char_length(title) >= 1 AND char_length(title) <= 120 AND title = btrim(title));
alter table only "public"."club_memberships"
  add constraint "club_memberships_privileged_role_active" CHECK (role = 'member'::text OR status = 'active'::text);
alter table only "public"."club_memberships"
  add constraint "club_memberships_role_value" CHECK (role = ANY (ARRAY['member'::text, 'official'::text, 'owner'::text]));
alter table only "public"."club_memberships"
  add constraint "club_memberships_status_value" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'left'::text]));
alter table only "public"."club_team_roster_members"
  add constraint "club_team_roster_members_position_check" CHECK ("position" >= 1 AND "position" <= 20);
alter table only "public"."club_teams"
  add constraint "club_teams_display_order_value" CHECK (display_order >= 1 AND display_order <= 1000000);
alter table only "public"."club_teams"
  add constraint "club_teams_name_length" CHECK (char_length(name) >= 1 AND char_length(name) <= 120);
alter table only "public"."club_teams"
  add constraint "club_teams_type_size_check" CHECK (unit_type IS NULL AND fixed_size IS NULL OR unit_type = 'pair'::text AND fixed_size = 2 OR unit_type = 'team'::text AND fixed_size >= 3 AND fixed_size <= 20);
alter table only "public"."clubs"
  add constraint "clubs_about_content_value" CHECK (about_content IS NULL OR char_length(about_content) >= 1 AND char_length(about_content) <= 20000 AND about_content = btrim(about_content));
alter table only "public"."clubs"
  add constraint "clubs_county_length" CHECK (county IS NULL OR char_length(county) >= 1 AND char_length(county) <= 100 AND county = btrim(county));
alter table only "public"."clubs"
  add constraint "clubs_name_length" CHECK (char_length(name) >= 2 AND char_length(name) <= 160 AND name = btrim(name));
alter table only "public"."clubs"
  add constraint "clubs_postcode_length" CHECK (postcode IS NULL OR char_length(postcode) >= 1 AND char_length(postcode) <= 20 AND postcode = btrim(postcode));
alter table only "public"."clubs"
  add constraint "clubs_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 2 AND char_length(slug) <= 180);
alter table only "public"."clubs"
  add constraint "clubs_status_value" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]));
alter table only "public"."clubs"
  add constraint "clubs_town_length" CHECK (town IS NULL OR char_length(town) >= 1 AND char_length(town) <= 100 AND town = btrim(town));
alter table only "public"."clubs"
  add constraint "clubs_website_value" CHECK (website IS NULL OR char_length(website) >= 8 AND char_length(website) <= 2048 AND website = btrim(website) AND website ~* '^https?://'::text);
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_average_review_value" CHECK (reviewed_starting_average_fingerprint IS NULL AND reviewed_starting_averages_at IS NULL OR reviewed_starting_average_fingerprint ~ '^[0-9a-f]{32}$'::text AND reviewed_starting_averages_at IS NOT NULL);
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_publication_time" CHECK (status = 'published'::text AND published_at IS NOT NULL OR status = 'draft'::text AND published_at IS NULL);
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_status_value" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]));
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_target_size_value" CHECK (target_size >= 1 AND target_size <= 1000);
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_name_value" CHECK (char_length(name) >= 1 AND char_length(name) <= 80 AND name = btrim(name));
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_position_value" CHECK ("position" >= 1 AND "position" <= 200);
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_slot_value" CHECK (slot_number >= 1 AND slot_number <= 20);
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_club_team_snapshot_check" CHECK (club_team_id IS NULL AND club_team_name_snapshot IS NULL OR club_team_id IS NOT NULL AND club_team_name_snapshot IS NOT NULL AND char_length(club_team_name_snapshot) >= 1 AND char_length(club_team_name_snapshot) <= 120);
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_position_value" CHECK ("position" >= 1 AND "position" <= 1000);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_a_qualifying_score_count_check" CHECK (qualifying_score_count >= 0 AND qualifying_score_count <= 1000000);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_average_starting_average_check" CHECK (starting_average >= 0::numeric AND starting_average <= 1000000::numeric AND starting_average = round(starting_average, 6));
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_check" CHECK (status = 'provisional'::text AND frozen_at IS NULL OR status = 'frozen'::text AND frozen_at IS NOT NULL);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_manual_reason_check" CHECK (manual_reason IS NULL OR manual_reason = btrim(manual_reason) AND char_length(manual_reason) >= 1 AND char_length(manual_reason) <= 500);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_status_check" CHECK (status = ANY (ARRAY['provisional'::text, 'frozen'::text]));
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_starting_averages_origin_consistency" CHECK (origin = 'calculated'::text AND starting_average IS NOT NULL AND source_competition_id IS NOT NULL AND qualifying_score_count > 0 AND manual_reason IS NULL OR origin = 'manual'::text AND starting_average IS NOT NULL AND source_competition_id IS NULL AND qualifying_score_count = 0 OR origin = 'no_history'::text AND starting_average IS NULL AND source_competition_id IS NULL AND qualifying_score_count = 0 AND manual_reason IS NULL);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_starting_averages_origin_value" CHECK (origin = ANY (ARRAY['calculated'::text, 'manual'::text, 'no_history'::text]));
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_check" CHECK (entrant_a_id <> entrant_b_id);
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_match_number_check" CHECK (match_number > 0);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_deadline_value" CHECK (deadline >= '1900-01-01'::date AND deadline <= '2200-12-31'::date);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_round_number_value" CHECK (round_number >= 1 AND round_number <= 100);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_shoot_by_value" CHECK (shoot_by_date IS NULL OR shoot_by_date >= '1900-01-01'::date AND shoot_by_date <= '2200-12-31'::date AND shoot_by_date <= deadline);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_distance_value" CHECK (distance_mode IS NULL AND distance_value IS NULL AND distance_unit IS NULL OR distance_mode = 'fixed'::text AND distance_value > 0::numeric AND distance_value <= 100000::numeric AND (distance_unit = ANY (ARRAY['metres'::text, 'yards'::text, 'feet'::text])) OR (distance_mode = ANY (ARRAY['variable'::text, 'not_applicable'::text])) AND distance_value IS NULL AND distance_unit IS NULL);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_label_value" CHECK (short_label IS NULL OR char_length(short_label) >= 1 AND char_length(short_label) <= 30 AND short_label = btrim(short_label));
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_maximum_value" CHECK (maximum_score >= 0.01 AND maximum_score <= 1000000::numeric AND maximum_score = round(maximum_score, 2));
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_method_value" CHECK (score_method = ANY (ARRAY['points_scored'::text, 'points_dropped'::text]));
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_position_choice_value" CHECK (shooting_position_mode IS NULL AND shooting_position_code IS NULL AND organisation_shooting_position_id IS NULL OR shooting_position_mode = 'fixed'::text AND ((shooting_position_code IS NOT NULL)::integer + (organisation_shooting_position_id IS NOT NULL)::integer) = 1 OR (shooting_position_mode = ANY (ARRAY['variable'::text, 'not_applicable'::text])) AND shooting_position_code IS NULL AND organisation_shooting_position_id IS NULL);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_position_value" CHECK ("position" >= 1 AND "position" <= 20);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_shots_value" CHECK (shots IS NULL OR shots >= 1 AND shots <= 10000);
alter table only "public"."competition_series"
  add constraint "competition_series_check" CHECK (entry_format = 'individual'::text AND team_size = 1 OR entry_format = 'pairs'::text AND team_size = 2 OR entry_format = 'team'::text AND team_size >= 3 AND team_size <= 20);
alter table only "public"."competition_series"
  add constraint "competition_series_check1" CHECK (discipline_code IS NOT NULL OR discipline_detail IS NULL);
alter table only "public"."competition_series"
  add constraint "competition_series_check2" CHECK (discipline_code IS DISTINCT FROM 'other'::text OR discipline_detail IS NOT NULL);
alter table only "public"."competition_series"
  add constraint "competition_series_discipline_code_check" CHECK (discipline_code IS NULL OR (discipline_code = ANY (ARRAY['rifle_prone'::text, 'rifle_benchrest'::text, 'rifle_three_position'::text, 'air_pistol'::text, 'other'::text])));
alter table only "public"."competition_series"
  add constraint "competition_series_discipline_detail_check" CHECK (discipline_detail IS NULL OR discipline_detail = btrim(discipline_detail) AND char_length(discipline_detail) >= 1 AND char_length(discipline_detail) <= 200);
alter table only "public"."competition_series"
  add constraint "competition_series_entry_format_check" CHECK (entry_format = ANY (ARRAY['individual'::text, 'pairs'::text, 'team'::text]));
alter table only "public"."competition_series"
  add constraint "competition_series_equipment_choice_value" CHECK ((equipment_type_code IS NULL OR organisation_equipment_type_id IS NULL) AND (shooting_details_version IS NOT NULL OR equipment_type_code IS NULL AND organisation_equipment_type_id IS NULL));
alter table only "public"."competition_series"
  add constraint "competition_series_name_check" CHECK (name = btrim(name) AND char_length(name) >= 2 AND char_length(name) <= 160);
alter table only "public"."competition_series"
  add constraint "competition_series_sets_per_round_check" CHECK (sets_per_round >= 1 AND sets_per_round <= 100);
alter table only "public"."competition_series"
  add constraint "competition_series_shooting_details_version_value" CHECK (shooting_details_version IS NULL OR shooting_details_version = 1);
alter table only "public"."competition_series"
  add constraint "competition_series_shots_per_round_check" CHECK (shots_per_round >= 1 AND shots_per_round <= 10000);
alter table only "public"."competition_series"
  add constraint "competition_series_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 2 AND char_length(slug) <= 180);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_components_distance_value" CHECK (distance_mode IS NULL AND distance_value IS NULL AND distance_unit IS NULL OR distance_mode = 'fixed'::text AND distance_value > 0::numeric AND distance_value <= 100000::numeric AND (distance_unit = ANY (ARRAY['metres'::text, 'yards'::text, 'feet'::text])) OR (distance_mode = ANY (ARRAY['variable'::text, 'not_applicable'::text])) AND distance_value IS NULL AND distance_unit IS NULL);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_components_position_choice_value" CHECK (shooting_position_mode IS NULL AND shooting_position_code IS NULL AND organisation_shooting_position_id IS NULL OR shooting_position_mode = 'fixed'::text AND ((shooting_position_code IS NOT NULL)::integer + (organisation_shooting_position_id IS NOT NULL)::integer) = 1 OR (shooting_position_mode = ANY (ARRAY['variable'::text, 'not_applicable'::text])) AND shooting_position_code IS NULL AND organisation_shooting_position_id IS NULL);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_components_shots_value" CHECK (shots IS NULL OR shots >= 1 AND shots <= 10000);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_maximum_score_check" CHECK (maximum_score >= 0.01 AND maximum_score <= 1000000::numeric);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_position_check" CHECK ("position" >= 1 AND "position" <= 20);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_score_method_check" CHECK (score_method = ANY (ARRAY['points_scored'::text, 'points_dropped'::text]));
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_short_label_check" CHECK (short_label = btrim(short_label) AND char_length(short_label) >= 1 AND char_length(short_label) <= 30);
alter table only "public"."competition_starting_average_finalisations"
  add constraint "competition_starting_average_finalisati_participant_count_check" CHECK (participant_count >= 1 AND participant_count <= 20000);
alter table only "public"."competition_starting_average_finalisations"
  add constraint "competition_starting_average_starting_average_fingerprint_check" CHECK (starting_average_fingerprint ~ '^[0-9a-f]{32}$'::text);
alter table only "public"."competitions"
  add constraint "competitions_best_n_x_value" CHECK (ranking_method <> 'best_n_average'::text OR uses_x_score = false);
alter table only "public"."competitions"
  add constraint "competitions_best_rounds_count_value" CHECK (ranking_method = 'best_n_average'::text AND best_rounds_count >= 1 AND best_rounds_count <= number_of_rounds OR ranking_method <> 'best_n_average'::text AND best_rounds_count IS NULL);
alter table only "public"."competitions"
  add constraint "competitions_custom_dates_supported_value" CHECK ((custom_entry_opens_at IS NULL OR custom_entry_opens_at >= '1900-01-01'::date AND custom_entry_opens_at <= '2200-12-31'::date) AND (custom_entry_closes_at IS NULL OR custom_entry_closes_at >= '1900-01-01'::date AND custom_entry_closes_at <= '2200-12-31'::date) AND (custom_starts_at IS NULL OR custom_starts_at >= '1900-01-01'::date AND custom_starts_at <= '2200-12-31'::date));
alter table only "public"."competitions"
  add constraint "competitions_custom_entry_window_value" CHECK (entry_window_mode = 'season_default'::text AND custom_entry_opens_at IS NULL AND custom_entry_closes_at IS NULL OR entry_window_mode = 'custom'::text AND (custom_entry_opens_at IS NULL OR custom_entry_closes_at IS NULL OR custom_entry_closes_at >= custom_entry_opens_at));
alter table only "public"."competitions"
  add constraint "competitions_custom_start_value" CHECK (start_date_mode = 'season_default'::text AND custom_starts_at IS NULL OR start_date_mode = 'custom'::text);
alter table only "public"."competitions"
  add constraint "competitions_description_value" CHECK (description IS NULL OR char_length(description) >= 1 AND char_length(description) <= 2000 AND description = btrim(description));
alter table only "public"."competitions"
  add constraint "competitions_discipline_value" CHECK ((discipline_code IS NULL OR (discipline_code = ANY (ARRAY['rifle_prone'::text, 'rifle_benchrest'::text, 'rifle_three_position'::text, 'air_pistol'::text, 'other'::text]))) AND (discipline_detail IS NULL OR discipline_detail = btrim(discipline_detail) AND char_length(discipline_detail) >= 1 AND char_length(discipline_detail) <= 200) AND (discipline_code IS NOT NULL OR discipline_detail IS NULL) AND (discipline_code IS DISTINCT FROM 'other'::text OR discipline_detail IS NOT NULL));
alter table only "public"."competitions"
  add constraint "competitions_entry_fee_value" CHECK (entry_fee IS NULL OR entry_fee >= 0::numeric AND entry_fee <= 10000::numeric);
alter table only "public"."competitions"
  add constraint "competitions_entry_format_value" CHECK (entry_format = ANY (ARRAY['individual'::text, 'pairs'::text, 'team'::text]));
alter table only "public"."competitions"
  add constraint "competitions_entry_window_mode_value" CHECK (entry_window_mode = ANY (ARRAY['season_default'::text, 'custom'::text]));
alter table only "public"."competitions"
  add constraint "competitions_equipment_choice_value" CHECK ((equipment_type_code IS NULL OR organisation_equipment_type_id IS NULL) AND (shooting_details_version IS NOT NULL OR equipment_type_code IS NULL AND organisation_equipment_type_id IS NULL));
alter table only "public"."competitions"
  add constraint "competitions_maximum_score_value" CHECK (maximum_score_per_round IS NULL OR maximum_score_per_round >= 1 AND maximum_score_per_round <= 1000000);
alter table only "public"."competitions"
  add constraint "competitions_name_value" CHECK (char_length(name) >= 2 AND char_length(name) <= 160 AND name = btrim(name));
alter table only "public"."competitions"
  add constraint "competitions_number_of_rounds_value" CHECK (number_of_rounds >= 1 AND number_of_rounds <= 100);
alter table only "public"."competitions"
  add constraint "competitions_ranking_method_value" CHECK (ranking_method = ANY (ARRAY['aggregate'::text, 'best_n_average'::text, 'round_robin'::text, 'gun_score'::text]));
alter table only "public"."competitions"
  add constraint "competitions_scoring_method_value" CHECK (scoring_method = ANY (ARRAY['points_dropped'::text, 'points_scored'::text]));
alter table only "public"."competitions"
  add constraint "competitions_sets_per_round_value" CHECK (sets_per_round >= 1 AND sets_per_round <= 100);
alter table only "public"."competitions"
  add constraint "competitions_shooting_details_version_value" CHECK (shooting_details_version IS NULL OR shooting_details_version = 1);
alter table only "public"."competitions"
  add constraint "competitions_shots_per_round_value" CHECK (shots_per_round IS NULL OR shots_per_round >= 1 AND shots_per_round <= 10000);
alter table only "public"."competitions"
  add constraint "competitions_slug_value" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 2 AND char_length(slug) <= 180);
alter table only "public"."competitions"
  add constraint "competitions_start_date_mode_value" CHECK (start_date_mode = ANY (ARRAY['season_default'::text, 'custom'::text]));
alter table only "public"."competitions"
  add constraint "competitions_status_value" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]));
alter table only "public"."competitions"
  add constraint "competitions_team_size_value" CHECK (entry_format = 'individual'::text AND team_size = 1 OR entry_format = 'pairs'::text AND team_size = 2 OR entry_format = 'team'::text AND team_size >= 3 AND team_size <= 20);
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_lifecycle_value" CHECK (status = 'draft'::text AND compatibility_version IS NULL AND compatibility_signature IS NULL AND activated_at IS NULL AND archived_at IS NULL OR status = 'active'::text AND (compatibility_version = ANY (ARRAY[1, 2])) AND compatibility_signature IS NOT NULL AND activated_at IS NOT NULL AND archived_at IS NULL OR status = 'archived'::text AND (compatibility_version = ANY (ARRAY[1, 2])) AND compatibility_signature IS NOT NULL AND activated_at IS NOT NULL AND archived_at IS NOT NULL);
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_name_value" CHECK (char_length(name) >= 2 AND char_length(name) <= 160 AND name = btrim(name));
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_status_value" CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text]));
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_label_value" CHECK (label IS NULL OR char_length(label) >= 1 AND char_length(label) <= 80 AND label = btrim(label));
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_position_value" CHECK ("position" >= 1 AND "position" <= 100);
alter table only "public"."league_seasons"
  add constraint "league_seasons_dates_order" CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at);
alter table only "public"."league_seasons"
  add constraint "league_seasons_description_length" CHECK (description IS NULL OR char_length(description) <= 2000 AND description = btrim(description));
alter table only "public"."league_seasons"
  add constraint "league_seasons_entry_dates_order" CHECK (entry_opens_at IS NULL OR entry_closes_at IS NULL OR entry_closes_at >= entry_opens_at);
alter table only "public"."league_seasons"
  add constraint "league_seasons_name_value" CHECK (char_length(name) >= 2 AND char_length(name) <= 160 AND name = btrim(name));
alter table only "public"."league_seasons"
  add constraint "league_seasons_slug_value" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 2 AND char_length(slug) <= 180);
alter table only "public"."league_seasons"
  add constraint "league_seasons_status_value" CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'active'::text, 'completed'::text]));
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_display_name_value" CHECK (display_name = private.clean_shooting_term(display_name) AND char_length(display_name) >= 2 AND char_length(display_name) <= 80);
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_normalized_name_value" CHECK (normalized_name = private.normalise_shooting_term(display_name));
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_content_value" CHECK (char_length(content) >= 1 AND char_length(content) <= 20000 AND content = btrim(content));
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_position_value" CHECK ("position" >= 1 AND "position" <= 5);
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_title_value" CHECK (char_length(title) >= 1 AND char_length(title) <= 120 AND title = btrim(title));
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_display_name_value" CHECK (display_name = private.clean_shooting_term(display_name) AND char_length(display_name) >= 2 AND char_length(display_name) <= 80);
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_normalized_name_value" CHECK (normalized_name = private.normalise_shooting_term(display_name));
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_owner_active" CHECK (role <> 'owner'::text OR status = 'active'::text);
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_role_value" CHECK (role = ANY (ARRAY['owner'::text, 'manager'::text]));
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_status_value" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'revoked'::text]));
alter table only "public"."organisations"
  add constraint "organisations_about_content_value" CHECK (about_content IS NULL OR char_length(about_content) >= 1 AND char_length(about_content) <= 20000 AND about_content = btrim(about_content));
alter table only "public"."organisations"
  add constraint "organisations_address_value" CHECK (address IS NULL OR char_length(address) >= 1 AND char_length(address) <= 1000 AND address = btrim(address));
alter table only "public"."organisations"
  add constraint "organisations_contact_email_value" CHECK (contact_email IS NULL OR char_length(contact_email) >= 3 AND char_length(contact_email) <= 320 AND contact_email = btrim(contact_email) AND contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text);
alter table only "public"."organisations"
  add constraint "organisations_description_length" CHECK (description IS NULL OR char_length(description) >= 1 AND char_length(description) <= 2000 AND description = btrim(description));
alter table only "public"."organisations"
  add constraint "organisations_name_length" CHECK (char_length(name) >= 2 AND char_length(name) <= 160 AND name = btrim(name));
alter table only "public"."organisations"
  add constraint "organisations_postcode_value" CHECK (postcode IS NULL OR char_length(postcode) >= 1 AND char_length(postcode) <= 20 AND postcode = btrim(postcode));
alter table only "public"."organisations"
  add constraint "organisations_short_name_length" CHECK (short_name IS NULL OR char_length(short_name) >= 1 AND char_length(short_name) <= 100 AND short_name = btrim(short_name));
alter table only "public"."organisations"
  add constraint "organisations_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND char_length(slug) >= 2 AND char_length(slug) <= 180);
alter table only "public"."organisations"
  add constraint "organisations_status_value" CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]));
alter table only "public"."organisations"
  add constraint "organisations_telephone_value" CHECK (telephone IS NULL OR char_length(telephone) >= 3 AND char_length(telephone) <= 50 AND telephone = btrim(telephone));
alter table only "public"."organisations"
  add constraint "organisations_type_value" CHECK (organisation_type = ANY (ARRAY['county_association'::text, 'regional_association'::text, 'business'::text, 'other'::text]));
alter table only "public"."organisations"
  add constraint "organisations_website_value" CHECK (website IS NULL OR char_length(website) >= 8 AND char_length(website) <= 2048 AND website = btrim(website) AND website ~* '^https?://[^[:space:]]+$'::text);
alter table only "public"."profiles"
  add constraint "profiles_address_length" CHECK (address IS NULL OR char_length(btrim(address)) >= 1 AND char_length(btrim(address)) <= 500);
alter table only "public"."profiles"
  add constraint "profiles_county_length" CHECK (county IS NULL OR char_length(btrim(county)) >= 1 AND char_length(btrim(county)) <= 100);
alter table only "public"."profiles"
  add constraint "profiles_first_name_length" CHECK (first_name IS NULL OR char_length(btrim(first_name)) >= 1 AND char_length(btrim(first_name)) <= 100);
alter table only "public"."profiles"
  add constraint "profiles_last_name_length" CHECK (last_name IS NULL OR char_length(btrim(last_name)) >= 1 AND char_length(btrim(last_name)) <= 100);
alter table only "public"."profiles"
  add constraint "profiles_phone_number_length" CHECK (phone_number IS NULL OR char_length(btrim(phone_number)) >= 1 AND char_length(btrim(phone_number)) <= 40);
alter table only "public"."profiles"
  add constraint "profiles_postcode_length" CHECK (postcode IS NULL OR char_length(btrim(postcode)) >= 1 AND char_length(btrim(postcode)) <= 20);
alter table only "public"."profiles"
  add constraint "profiles_title_value" CHECK (title IS NULL OR (title = ANY (ARRAY['Mr'::text, 'Mrs'::text, 'Ms'::text, 'Miss'::text, 'Dr'::text, 'Other'::text, 'Prefer not to say'::text])));
alter table only "public"."profiles"
  add constraint "profiles_town_length" CHECK (town IS NULL OR char_length(btrim(town)) >= 1 AND char_length(btrim(town)) <= 100);
alter table only "public"."shooting_equipment_types"
  add constraint "shooting_equipment_types_code_value" CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'::text);
alter table only "public"."shooting_equipment_types"
  add constraint "shooting_equipment_types_display_name_value" CHECK (display_name = private.clean_shooting_term(display_name) AND char_length(display_name) >= 2 AND char_length(display_name) <= 80);
alter table only "public"."shooting_equipment_types"
  add constraint "shooting_equipment_types_sort_order_value" CHECK (sort_order > 0);
alter table only "public"."shooting_positions"
  add constraint "shooting_positions_code_value" CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'::text);
alter table only "public"."shooting_positions"
  add constraint "shooting_positions_display_name_value" CHECK (display_name = private.clean_shooting_term(display_name) AND char_length(display_name) >= 2 AND char_length(display_name) <= 80);
alter table only "public"."shooting_positions"
  add constraint "shooting_positions_sort_order_value" CHECK (sort_order > 0);
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_after_state_value" CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object'::text);
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_before_state_value" CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object'::text);
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_operation_value" CHECK (operation = ANY (ARRAY['create'::text, 'update'::text, 'clear'::text]));
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_origin_value" CHECK (origin_competition_round_id IS NULL OR origin_competition_id IS NOT NULL);
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_reason_value" CHECK (reason IS NULL OR char_length(reason) >= 1 AND char_length(reason) <= 500 AND reason = btrim(reason));
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_state_value" CHECK (before_state IS NOT NULL OR after_state IS NOT NULL);
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_version_value" CHECK (version >= 1);
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_achieved_score_value" CHECK (achieved_score >= 0::numeric AND achieved_score <= 1000000::numeric AND achieved_score = round(achieved_score, 2));
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_component_position_value" CHECK (component_position >= 1 AND component_position <= 20);
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_set_number_value" CHECK (set_number >= 1 AND set_number <= 100);
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_x_count_value" CHECK (x_count IS NULL OR x_count >= 0 AND x_count <= 10000);
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sourc_achieved_score_at_calculatio_check" CHECK (achieved_score_at_calculation >= 0::numeric AND achieved_score_at_calculation <= 1000000::numeric);
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_maximum_at_calculation_check" CHECK (maximum_at_calculation >= 0.01 AND maximum_at_calculation <= 1000000::numeric);

CREATE INDEX average_contexts_created_by_idx ON public.average_contexts USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX average_contexts_organisation_lower_name_unique ON public.average_contexts USING btree (organisation_id, lower(name));
CREATE INDEX average_contexts_updated_by_idx ON public.average_contexts USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX average_policies_created_by_idx ON public.average_policies USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX average_policies_organisation_lower_name_unique ON public.average_policies USING btree (organisation_id, lower(name));
CREATE INDEX average_policies_updated_by_idx ON public.average_policies USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX average_policy_versions_created_by_idx ON public.average_policy_versions USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX club_competition_entries_club_status_competition_idx ON public.club_competition_entries USING btree (club_id, status, competition_id);
CREATE INDEX club_competition_entries_created_by_idx ON public.club_competition_entries USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX club_competition_entries_updated_by_idx ON public.club_competition_entries USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX club_information_cards_created_by_idx ON public.club_information_cards USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX club_information_cards_updated_by_idx ON public.club_information_cards USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX club_memberships_club_status_updated_idx ON public.club_memberships USING btree (club_id, status, updated_at DESC);
CREATE UNIQUE INDEX club_memberships_one_owner_per_club_idx ON public.club_memberships USING btree (club_id) WHERE (role = 'owner'::text);
CREATE INDEX club_memberships_user_status_created_idx ON public.club_memberships USING btree (user_id, status, created_at DESC);
CREATE INDEX club_team_roster_members_membership_idx ON public.club_team_roster_members USING btree (club_membership_id);
CREATE INDEX club_teams_club_archive_order_idx ON public.club_teams USING btree (club_id, archived_at, display_order, id);
CREATE UNIQUE INDEX club_teams_club_name_ci_unique ON public.club_teams USING btree (club_id, lower(name));
CREATE INDEX club_teams_created_by_idx ON public.club_teams USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX club_teams_updated_by_idx ON public.club_teams USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX clubs_active_name_idx ON public.clubs USING btree (name, id) WHERE (status = 'active'::text);
CREATE INDEX clubs_active_search_document_idx ON public.clubs USING gin (search_document) WHERE (status = 'active'::text);
CREATE INDEX competition_average_settings_context_history_idx ON public.competition_average_settings USING btree (average_context_id, competition_id) WHERE contributes_to_history;
CREATE INDEX competition_average_settings_created_by_idx ON public.competition_average_settings USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competition_average_settings_policy_version_idx ON public.competition_average_settings USING btree (average_policy_version_id);
CREATE INDEX competition_average_settings_updated_by_idx ON public.competition_average_settings USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX competition_division_assignments_competition_division_idx ON public.competition_division_assignments USING btree (competition_id, competition_division_id, competition_entrant_id);
CREATE INDEX competition_division_configs_created_by_idx ON public.competition_division_configs USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competition_division_configs_updated_by_idx ON public.competition_division_configs USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE UNIQUE INDEX competition_divisions_competition_lower_name_unique_idx ON public.competition_divisions USING btree (competition_id, lower(name));
CREATE INDEX competition_entrant_participants_membership_idx ON public.competition_entrant_participants USING btree (club_membership_id);
CREATE INDEX competition_entrants_club_team_idx ON public.competition_entrants USING btree (club_team_id) WHERE (club_team_id IS NOT NULL);
CREATE UNIQUE INDEX competition_entrants_entry_club_team_unique ON public.competition_entrants USING btree (club_competition_entry_id, club_team_id) WHERE (club_team_id IS NOT NULL);
CREATE INDEX starting_averages_competition_idx ON public.competition_participant_starting_averages USING btree (competition_id, competition_entrant_participant_id);
CREATE INDEX starting_averages_context_idx ON public.competition_participant_starting_averages USING btree (average_context_id);
CREATE INDEX starting_averages_created_by_idx ON public.competition_participant_starting_averages USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX starting_averages_policy_version_idx ON public.competition_participant_starting_averages USING btree (average_policy_version_id);
CREATE INDEX starting_averages_shooter_idx ON public.competition_participant_starting_averages USING btree (shooter_profile_id, competition_id);
CREATE INDEX starting_averages_source_competition_idx ON public.competition_participant_starting_averages USING btree (source_competition_id) WHERE (source_competition_id IS NOT NULL);
CREATE INDEX starting_averages_updated_by_idx ON public.competition_participant_starting_averages USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX round_robin_fixtures_a_idx ON public.competition_round_robin_fixtures USING btree (entrant_a_id);
CREATE INDEX round_robin_fixtures_b_idx ON public.competition_round_robin_fixtures USING btree (entrant_b_id);
CREATE INDEX round_robin_fixtures_division_idx ON public.competition_round_robin_fixtures USING btree (division_id);
CREATE INDEX round_robin_fixtures_round_idx ON public.competition_round_robin_fixtures USING btree (round_id);
CREATE UNIQUE INDEX competition_rounds_id_competition_unique_idx ON public.competition_rounds USING btree (id, competition_id);
CREATE INDEX competition_components_organisation_position_idx ON public.competition_score_components USING btree (organisation_shooting_position_id) WHERE (organisation_shooting_position_id IS NOT NULL);
CREATE INDEX competition_score_usages_created_by_idx ON public.competition_score_usages USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competition_score_usages_participant_idx ON public.competition_score_usages USING btree (competition_entrant_participant_id);
CREATE INDEX competition_score_usages_round_idx ON public.competition_score_usages USING btree (competition_round_id);
CREATE INDEX competition_score_usages_updated_by_idx ON public.competition_score_usages USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX competition_series_created_by_idx ON public.competition_series USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competition_series_organisation_equipment_type_idx ON public.competition_series USING btree (organisation_equipment_type_id) WHERE (organisation_equipment_type_id IS NOT NULL);
CREATE INDEX competition_series_updated_by_idx ON public.competition_series USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX competition_series_average_defaults_context_idx ON public.competition_series_average_defaults USING btree (average_context_id);
CREATE INDEX competition_series_average_defaults_created_by_idx ON public.competition_series_average_defaults USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competition_series_average_defaults_policy_version_idx ON public.competition_series_average_defaults USING btree (average_policy_version_id);
CREATE INDEX competition_series_average_defaults_updated_by_idx ON public.competition_series_average_defaults USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX competition_series_components_org_position_idx ON public.competition_series_score_components USING btree (organisation_shooting_position_id) WHERE (organisation_shooting_position_id IS NOT NULL);
CREATE INDEX competition_starting_average_finalisations_finalised_by_idx ON public.competition_starting_average_finalisations USING btree (finalised_by) WHERE (finalised_by IS NOT NULL);
CREATE INDEX competitions_configuration_source_idx ON public.competitions USING btree (configuration_source_competition_id) WHERE (configuration_source_competition_id IS NOT NULL);
CREATE INDEX competitions_created_by_idx ON public.competitions USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX competitions_organisation_equipment_type_idx ON public.competitions USING btree (organisation_equipment_type_id) WHERE (organisation_equipment_type_id IS NOT NULL);
CREATE UNIQUE INDEX competitions_season_lower_name_unique_idx ON public.competitions USING btree (league_season_id, lower(name));
CREATE INDEX competitions_season_status_id_idx ON public.competitions USING btree (league_season_id, status, id);
CREATE INDEX competitions_series_idx ON public.competitions USING btree (competition_series_id, league_season_id, id) WHERE (competition_series_id IS NOT NULL);
CREATE UNIQUE INDEX competitions_series_season_unique ON public.competitions USING btree (competition_series_id, league_season_id) WHERE (competition_series_id IS NOT NULL);
CREATE INDEX competitions_updated_by_idx ON public.competitions USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX concurrent_shooting_group_competitions_created_by_idx ON public.concurrent_shooting_group_competitions USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX concurrent_shooting_groups_created_by_idx ON public.concurrent_shooting_groups USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX concurrent_shooting_groups_org_lower_name_unique_idx ON public.concurrent_shooting_groups USING btree (organisation_id, lower(name));
CREATE INDEX concurrent_shooting_groups_season_status_idx ON public.concurrent_shooting_groups USING btree (league_season_id, status, id);
CREATE INDEX concurrent_shooting_groups_updated_by_idx ON public.concurrent_shooting_groups USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX concurrent_shooting_round_mappings_competition_idx ON public.concurrent_shooting_round_mappings USING btree (competition_id);
CREATE INDEX concurrent_shooting_round_mappings_created_by_idx ON public.concurrent_shooting_round_mappings USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX concurrent_shooting_round_mappings_group_idx ON public.concurrent_shooting_round_mappings USING btree (concurrent_shooting_group_id, concurrent_shooting_round_id);
CREATE INDEX concurrent_shooting_round_mappings_round_competition_idx ON public.concurrent_shooting_round_mappings USING btree (concurrent_shooting_round_id, competition_id, competition_round_id);
CREATE INDEX concurrent_shooting_rounds_created_by_idx ON public.concurrent_shooting_rounds USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX concurrent_shooting_rounds_updated_by_idx ON public.concurrent_shooting_rounds USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX league_seasons_created_by_idx ON public.league_seasons USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX league_seasons_id_organisation_unique_idx ON public.league_seasons USING btree (id, organisation_id);
CREATE INDEX league_seasons_organisation_status_starts_idx ON public.league_seasons USING btree (organisation_id, status, starts_at, id);
CREATE INDEX league_seasons_updated_by_idx ON public.league_seasons USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX organisation_equipment_types_created_by_idx ON public.organisation_equipment_types USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX organisation_information_cards_created_by_idx ON public.organisation_information_cards USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX organisation_information_cards_updated_by_idx ON public.organisation_information_cards USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX organisation_shooting_positions_created_by_idx ON public.organisation_shooting_positions USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX organisation_staff_one_owner_per_organisation_idx ON public.organisation_staff USING btree (organisation_id) WHERE (role = 'owner'::text);
CREATE INDEX organisation_staff_organisation_status_updated_idx ON public.organisation_staff USING btree (organisation_id, status, updated_at DESC, id);
CREATE INDEX organisation_staff_user_status_organisation_idx ON public.organisation_staff USING btree (user_id, status, organisation_id);
CREATE INDEX organisations_active_name_idx ON public.organisations USING btree (name, id) WHERE (status = 'active'::text);
CREATE INDEX organisations_active_search_document_idx ON public.organisations USING gin (search_document) WHERE (status = 'active'::text);
CREATE INDEX shooting_score_change_events_actor_idx ON public.shooting_score_change_events USING btree (actor_id) WHERE (actor_id IS NOT NULL);
CREATE INDEX shooting_score_change_events_origin_competition_idx ON public.shooting_score_change_events USING btree (origin_competition_id, created_at) WHERE (origin_competition_id IS NOT NULL);
CREATE INDEX shooting_score_change_events_origin_round_idx ON public.shooting_score_change_events USING btree (origin_competition_round_id) WHERE (origin_competition_round_id IS NOT NULL);
CREATE INDEX shooting_score_change_events_source_created_idx ON public.shooting_score_change_events USING btree (shooting_score_source_id, created_at, id);
CREATE INDEX shooting_score_sources_concurrent_round_idx ON public.shooting_score_sources USING btree (concurrent_shooting_round_id) WHERE (concurrent_shooting_round_id IS NOT NULL);
CREATE UNIQUE INDEX shooting_score_sources_concurrent_shooter_unique_idx ON public.shooting_score_sources USING btree (concurrent_shooting_round_id, shooter_profile_id) WHERE (concurrent_shooting_round_id IS NOT NULL);
CREATE INDEX shooting_score_sources_created_by_idx ON public.shooting_score_sources USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX shooting_score_sources_shooter_profile_idx ON public.shooting_score_sources USING btree (shooter_profile_id);
CREATE INDEX shooting_score_sources_updated_by_idx ON public.shooting_score_sources USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX shooting_score_values_created_by_idx ON public.shooting_score_values USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX shooting_score_values_updated_by_idx ON public.shooting_score_values USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX starting_average_score_sources_competition_idx ON public.starting_average_score_sources USING btree (competition_id) WHERE (competition_id IS NOT NULL);
CREATE UNIQUE INDEX starting_average_score_sources_physical_unique ON public.starting_average_score_sources USING btree (starting_average_id, shooting_score_source_id) WHERE (shooting_score_source_id IS NOT NULL);
CREATE INDEX starting_average_score_sources_round_idx ON public.starting_average_score_sources USING btree (round_id) WHERE (round_id IS NOT NULL);
CREATE INDEX starting_average_score_sources_source_idx ON public.starting_average_score_sources USING btree (shooting_score_source_id) WHERE (shooting_score_source_id IS NOT NULL);
CREATE INDEX user_organisations_organisation_id_idx ON public.user_organisations USING btree (organisation_id, user_id);

alter table only "public"."average_contexts"
  add constraint "average_contexts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."average_contexts"
  add constraint "average_contexts_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id);
alter table only "public"."average_contexts"
  add constraint "average_contexts_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."average_policies"
  add constraint "average_policies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."average_policies"
  add constraint "average_policies_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id);
alter table only "public"."average_policies"
  add constraint "average_policies_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_average_policy_id_fkey" FOREIGN KEY (average_policy_id) REFERENCES average_policies(id);
alter table only "public"."average_policy_versions"
  add constraint "average_policy_versions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_club_id_fkey" FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_competition_entries"
  add constraint "club_competition_entries_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_club_id_fkey" FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_information_cards"
  add constraint "club_information_cards_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_memberships"
  add constraint "club_memberships_club_id_fkey" FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
alter table only "public"."club_memberships"
  add constraint "club_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table only "public"."club_team_roster_members"
  add constraint "club_team_roster_members_club_membership_id_fkey" FOREIGN KEY (club_membership_id) REFERENCES club_memberships(id) ON DELETE RESTRICT;
alter table only "public"."club_team_roster_members"
  add constraint "club_team_roster_members_club_team_id_fkey" FOREIGN KEY (club_team_id) REFERENCES club_teams(id) ON DELETE CASCADE;
alter table only "public"."club_teams"
  add constraint "club_teams_club_id_fkey" FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
alter table only "public"."club_teams"
  add constraint "club_teams_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."club_teams"
  add constraint "club_teams_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_average_context_id_fkey" FOREIGN KEY (average_context_id) REFERENCES average_contexts(id);
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_average_policy_version_id_fkey" FOREIGN KEY (average_policy_version_id) REFERENCES average_policy_versions(id);
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_average_settings"
  add constraint "competition_average_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_division_assignments"
  add constraint "competition_division_assignments_competition_entrant_id_fkey" FOREIGN KEY (competition_entrant_id) REFERENCES competition_entrants(id) ON DELETE CASCADE;
alter table only "public"."competition_division_assignments"
  add constraint "competition_division_assignments_division_competition_fkey" FOREIGN KEY (competition_division_id, competition_id) REFERENCES competition_divisions(id, competition_id) ON DELETE CASCADE;
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_division_configs"
  add constraint "competition_division_configs_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_divisions"
  add constraint "competition_divisions_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competition_division_configs(competition_id) ON DELETE CASCADE;
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_club_competition_entry_id_fkey" FOREIGN KEY (club_competition_entry_id) REFERENCES club_competition_entries(id) ON DELETE CASCADE;
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_club_membership_id_fkey" FOREIGN KEY (club_membership_id) REFERENCES club_memberships(id);
alter table only "public"."competition_entrant_participants"
  add constraint "competition_entrant_participants_entrant_entry_fkey" FOREIGN KEY (competition_entrant_id, club_competition_entry_id) REFERENCES competition_entrants(id, club_competition_entry_id) ON DELETE CASCADE;
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_club_competition_entry_id_fkey" FOREIGN KEY (club_competition_entry_id) REFERENCES club_competition_entries(id) ON DELETE CASCADE;
alter table only "public"."competition_entrants"
  add constraint "competition_entrants_club_team_fkey" FOREIGN KEY (club_team_id) REFERENCES club_teams(id) ON DELETE RESTRICT;
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_start_competition_entrant_particip_fkey" FOREIGN KEY (competition_entrant_participant_id) REFERENCES competition_entrant_participants(id) ON DELETE CASCADE;
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_ave_source_competition_id_fkey" FOREIGN KEY (source_competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averag_average_context_id_fkey" FOREIGN KEY (average_context_id) REFERENCES average_contexts(id);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averag_shooter_profile_id_fkey" FOREIGN KEY (shooter_profile_id) REFERENCES profiles(id);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_average_policy_version_id_fkey" FOREIGN KEY (average_policy_version_id) REFERENCES average_policy_versions(id);
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_participant_starting_averages"
  add constraint "competition_participant_starting_averages_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_division_id_fkey" FOREIGN KEY (division_id) REFERENCES competition_divisions(id);
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_entrant_a_id_fkey" FOREIGN KEY (entrant_a_id) REFERENCES competition_entrants(id);
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_entrant_b_id_fkey" FOREIGN KEY (entrant_b_id) REFERENCES competition_entrants(id);
alter table only "public"."competition_round_robin_fixtures"
  add constraint "competition_round_robin_fixtures_round_id_fkey" FOREIGN KEY (round_id) REFERENCES competition_rounds(id);
alter table only "public"."competition_rounds"
  add constraint "competition_rounds_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_organisation_position_id_fkey" FOREIGN KEY (organisation_shooting_position_id) REFERENCES organisation_shooting_positions(id);
alter table only "public"."competition_score_components"
  add constraint "competition_score_components_shooting_position_code_fkey" FOREIGN KEY (shooting_position_code) REFERENCES shooting_positions(code);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_competition_entrant_participant_i_fkey" FOREIGN KEY (competition_entrant_participant_id) REFERENCES competition_entrant_participants(id);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE;
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_competition_round_id_fkey" FOREIGN KEY (competition_round_id) REFERENCES competition_rounds(id);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_shooting_score_source_id_fkey" FOREIGN KEY (shooting_score_source_id) REFERENCES shooting_score_sources(id);
alter table only "public"."competition_score_usages"
  add constraint "competition_score_usages_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_series"
  add constraint "competition_series_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_series"
  add constraint "competition_series_equipment_type_code_fkey" FOREIGN KEY (equipment_type_code) REFERENCES shooting_equipment_types(code);
alter table only "public"."competition_series"
  add constraint "competition_series_organisation_equipment_type_id_fkey" FOREIGN KEY (organisation_equipment_type_id) REFERENCES organisation_equipment_types(id);
alter table only "public"."competition_series"
  add constraint "competition_series_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id);
alter table only "public"."competition_series"
  add constraint "competition_series_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defau_average_policy_version_id_fkey" FOREIGN KEY (average_policy_version_id) REFERENCES average_policy_versions(id);
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defaults_average_context_id_fkey" FOREIGN KEY (average_context_id) REFERENCES average_contexts(id);
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defaults_competition_series_id_fkey" FOREIGN KEY (competition_series_id) REFERENCES competition_series(id) ON DELETE CASCADE;
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defaults_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_series_average_defaults"
  add constraint "competition_series_average_defaults_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_components_org_position_id_fkey" FOREIGN KEY (organisation_shooting_position_id) REFERENCES organisation_shooting_positions(id);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_components_position_code_fkey" FOREIGN KEY (shooting_position_code) REFERENCES shooting_positions(code);
alter table only "public"."competition_series_score_components"
  add constraint "competition_series_score_components_competition_series_id_fkey" FOREIGN KEY (competition_series_id) REFERENCES competition_series(id) ON DELETE CASCADE;
alter table only "public"."competition_starting_average_finalisations"
  add constraint "competition_starting_average_finalisations_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competition_average_settings(competition_id) ON DELETE CASCADE;
alter table only "public"."competition_starting_average_finalisations"
  add constraint "competition_starting_average_finalisations_finalised_by_fkey" FOREIGN KEY (finalised_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competitions"
  add constraint "competitions_competition_series_id_fkey" FOREIGN KEY (competition_series_id) REFERENCES competition_series(id);
alter table only "public"."competitions"
  add constraint "competitions_configuration_source_competition_id_fkey" FOREIGN KEY (configuration_source_competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
alter table only "public"."competitions"
  add constraint "competitions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."competitions"
  add constraint "competitions_equipment_type_code_fkey" FOREIGN KEY (equipment_type_code) REFERENCES shooting_equipment_types(code);
alter table only "public"."competitions"
  add constraint "competitions_league_season_id_fkey" FOREIGN KEY (league_season_id) REFERENCES league_seasons(id) ON DELETE CASCADE;
alter table only "public"."competitions"
  add constraint "competitions_organisation_equipment_type_id_fkey" FOREIGN KEY (organisation_equipment_type_id) REFERENCES organisation_equipment_types(id);
alter table only "public"."competitions"
  add constraint "competitions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_group_competitions"
  add constraint "concurrent_shooting_group_com_concurrent_shooting_group_id_fkey" FOREIGN KEY (concurrent_shooting_group_id) REFERENCES concurrent_shooting_groups(id) ON DELETE CASCADE;
alter table only "public"."concurrent_shooting_group_competitions"
  add constraint "concurrent_shooting_group_competitions_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE RESTRICT;
alter table only "public"."concurrent_shooting_group_competitions"
  add constraint "concurrent_shooting_group_competitions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_league_season_id_fkey" FOREIGN KEY (league_season_id) REFERENCES league_seasons(id) ON DELETE RESTRICT;
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT;
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_season_organisation_fk" FOREIGN KEY (league_season_id, organisation_id) REFERENCES league_seasons(id, organisation_id) ON DELETE RESTRICT;
alter table only "public"."concurrent_shooting_groups"
  add constraint "concurrent_shooting_groups_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_competition_round_fk" FOREIGN KEY (competition_round_id, competition_id) REFERENCES competition_rounds(id, competition_id) ON DELETE RESTRICT;
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_group_competition_fk" FOREIGN KEY (concurrent_shooting_group_id, competition_id) REFERENCES concurrent_shooting_group_competitions(concurrent_shooting_group_id, competition_id) ON DELETE CASCADE;
alter table only "public"."concurrent_shooting_round_mappings"
  add constraint "concurrent_shooting_round_mappings_group_round_fk" FOREIGN KEY (concurrent_shooting_round_id, concurrent_shooting_group_id) REFERENCES concurrent_shooting_rounds(id, concurrent_shooting_group_id) ON DELETE CASCADE;
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_concurrent_shooting_group_id_fkey" FOREIGN KEY (concurrent_shooting_group_id) REFERENCES concurrent_shooting_groups(id) ON DELETE CASCADE;
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."concurrent_shooting_rounds"
  add constraint "concurrent_shooting_rounds_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."league_seasons"
  add constraint "league_seasons_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."league_seasons"
  add constraint "league_seasons_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."league_seasons"
  add constraint "league_seasons_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."organisation_equipment_types"
  add constraint "organisation_equipment_types_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."organisation_information_cards"
  add constraint "organisation_information_cards_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."organisation_shooting_positions"
  add constraint "organisation_shooting_positions_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."organisation_staff"
  add constraint "organisation_staff_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table only "public"."profiles"
  add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_origin_competition_id_fkey" FOREIGN KEY (origin_competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_origin_competition_round_id_fkey" FOREIGN KEY (origin_competition_round_id) REFERENCES competition_rounds(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_change_events"
  add constraint "shooting_score_change_events_shooting_score_source_id_fkey" FOREIGN KEY (shooting_score_source_id) REFERENCES shooting_score_sources(id) ON DELETE RESTRICT;
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_concurrent_round_fk" FOREIGN KEY (concurrent_shooting_round_id) REFERENCES concurrent_shooting_rounds(id) ON DELETE RESTRICT;
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_shooter_profile_id_fkey" FOREIGN KEY (shooter_profile_id) REFERENCES profiles(id);
alter table only "public"."shooting_score_sources"
  add constraint "shooting_score_sources_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_shooting_score_source_id_fkey" FOREIGN KEY (shooting_score_source_id) REFERENCES shooting_score_sources(id) ON DELETE CASCADE;
alter table only "public"."shooting_score_values"
  add constraint "shooting_score_values_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL;
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_round_id_fkey" FOREIGN KEY (round_id) REFERENCES competition_rounds(id) ON DELETE SET NULL;
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_shooting_score_source_id_fkey" FOREIGN KEY (shooting_score_source_id) REFERENCES shooting_score_sources(id) ON DELETE SET NULL;
alter table only "public"."starting_average_score_sources"
  add constraint "starting_average_score_sources_starting_average_id_fkey" FOREIGN KEY (starting_average_id) REFERENCES competition_participant_starting_averages(id) ON DELETE CASCADE;
alter table only "public"."user_organisations"
  add constraint "user_organisations_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE;
alter table only "public"."user_organisations"
  add constraint "user_organisations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

insert into public.profiles (
  id, first_name, last_name, created_at, updated_at
)
select users.id,
  left(nullif(btrim(users.raw_user_meta_data ->> 'first_name'), ''), 100),
  left(nullif(btrim(users.raw_user_meta_data ->> 'last_name'), ''), 100),
  users.created_at, users.created_at
from auth.users as users
on conflict (id) do nothing;

insert into public.shooting_equipment_types (code, display_name, sort_order)
values
  ('smallbore_rifle', 'Smallbore Rifle', 10),
  ('fullbore_rifle', 'Fullbore Rifle', 20),
  ('lightweight_sporting_rifle', 'Lightweight Sporting Rifle', 30),
  ('gallery_rifle', 'Gallery Rifle', 40),
  ('air_rifle', 'Air Rifle', 50),
  ('pistol', 'Pistol', 60),
  ('air_pistol', 'Air Pistol', 70),
  ('shotgun', 'Shotgun', 80)
on conflict (code) do update
set display_name=excluded.display_name, sort_order=excluded.sort_order;

insert into public.shooting_positions (code, display_name, sort_order)
values
  ('prone', 'Prone', 10),
  ('standing', 'Standing', 20),
  ('kneeling', 'Kneeling', 30),
  ('benchrest', 'Benchrest', 40)
on conflict (code) do update
set display_name=excluded.display_name, sort_order=excluded.sort_order;

CREATE TRIGGER on_auth_user_profile_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user_profile();
CREATE TRIGGER protect_average_context_basis BEFORE UPDATE ON average_contexts FOR EACH ROW EXECUTE FUNCTION private.protect_average_context_basis();
CREATE TRIGGER set_average_policies_updated_at BEFORE UPDATE ON average_policies FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_average_policy_version BEFORE DELETE OR UPDATE ON average_policy_versions FOR EACH ROW EXECUTE FUNCTION private.protect_average_policy_version();
CREATE TRIGGER validate_average_policy_version_definition BEFORE INSERT ON average_policy_versions FOR EACH ROW EXECUTE FUNCTION private.validate_average_policy_version_definition();
CREATE TRIGGER protect_draft_entry_from_archived_team BEFORE UPDATE OF status ON club_competition_entries FOR EACH ROW EXECUTE FUNCTION private.protect_draft_entry_from_archived_team();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE OF status, competition_id, club_id ON club_competition_entries FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER protect_scored_competition_entry BEFORE UPDATE OF status ON club_competition_entries FOR EACH ROW EXECUTE FUNCTION private.protect_scored_competition_entry();
CREATE TRIGGER reconcile_concurrent_shooting_entry AFTER INSERT OR UPDATE OF status ON club_competition_entries FOR EACH ROW EXECUTE FUNCTION private.reconcile_concurrent_shooting_entry_trigger();
CREATE TRIGGER set_club_competition_entries_updated_at BEFORE UPDATE ON club_competition_entries FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_club_information_cards_updated_at BEFORE UPDATE ON club_information_cards FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER enforce_authenticated_membership_transition BEFORE UPDATE ON club_memberships FOR EACH ROW EXECUTE FUNCTION private.enforce_authenticated_membership_transition();
CREATE TRIGGER set_club_memberships_updated_at BEFORE UPDATE ON club_memberships FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE CONSTRAINT TRIGGER validate_club_team_roster_complete_from_member AFTER INSERT OR DELETE OR UPDATE ON club_team_roster_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_club_team_roster_complete();
CREATE TRIGGER validate_club_team_roster_member BEFORE INSERT OR UPDATE OF club_team_id, "position", club_membership_id ON club_team_roster_members FOR EACH ROW EXECUTE FUNCTION private.validate_club_team_roster_member();
CREATE TRIGGER normalise_club_team_name BEFORE INSERT OR UPDATE OF name ON club_teams FOR EACH ROW EXECUTE FUNCTION private.normalise_club_team_name();
CREATE TRIGGER protect_club_team_type_size BEFORE UPDATE OF unit_type, fixed_size ON club_teams FOR EACH ROW EXECUTE FUNCTION private.protect_club_team_type_size();
CREATE TRIGGER set_club_teams_updated_at BEFORE UPDATE ON club_teams FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE CONSTRAINT TRIGGER validate_club_team_roster_complete_from_team AFTER INSERT OR UPDATE OF unit_type, fixed_size ON club_teams DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_club_team_roster_complete();
CREATE TRIGGER set_clubs_updated_at BEFORE UPDATE ON clubs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_competition_average_setting BEFORE DELETE OR UPDATE ON competition_average_settings FOR EACH ROW EXECUTE FUNCTION private.protect_competition_average_setting();
CREATE TRIGGER validate_competition_average_setting BEFORE INSERT OR UPDATE ON competition_average_settings FOR EACH ROW EXECUTE FUNCTION private.validate_competition_average_setting();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE ON competition_division_assignments FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER set_competition_division_assignments_updated_at BEFORE UPDATE ON competition_division_assignments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_division_assignment BEFORE INSERT OR UPDATE OF competition_entrant_id, competition_id, competition_division_id ON competition_division_assignments FOR EACH ROW EXECUTE FUNCTION private.validate_competition_division_assignment();
CREATE TRIGGER round_robin_division_lifecycle AFTER INSERT OR DELETE OR UPDATE ON competition_division_configs FOR EACH ROW EXECUTE FUNCTION private.round_robin_division_lifecycle();
CREATE TRIGGER set_competition_division_configs_updated_at BEFORE UPDATE ON competition_division_configs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE OF competition_id ON competition_divisions FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER set_competition_divisions_updated_at BEFORE UPDATE ON competition_divisions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE ON competition_entrant_participants FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER set_competition_entrant_participants_updated_at BEFORE UPDATE ON competition_entrant_participants FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_entry_participant BEFORE INSERT OR UPDATE OF club_competition_entry_id, competition_entrant_id, club_membership_id, slot_number ON competition_entrant_participants FOR EACH ROW EXECUTE FUNCTION private.validate_competition_entry_participant();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE ON competition_entrants FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER set_competition_entrants_updated_at BEFORE UPDATE ON competition_entrants FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_entrant_club_team BEFORE INSERT OR UPDATE OF club_competition_entry_id, club_team_id, club_team_name_snapshot ON competition_entrants FOR EACH ROW EXECUTE FUNCTION private.validate_competition_entrant_club_team();
CREATE TRIGGER block_starting_average_after_finalisation BEFORE INSERT OR UPDATE ON competition_participant_starting_averages FOR EACH ROW EXECUTE FUNCTION private.block_starting_average_after_finalisation();
CREATE TRIGGER protect_frozen_starting_average BEFORE UPDATE ON competition_participant_starting_averages FOR EACH ROW EXECUTE FUNCTION private.protect_frozen_starting_average();
CREATE TRIGGER validate_starting_average_snapshot BEFORE INSERT OR UPDATE ON competition_participant_starting_averages FOR EACH ROW EXECUTE FUNCTION private.validate_starting_average_snapshot();
CREATE TRIGGER protect_round_robin_composition BEFORE INSERT OR DELETE OR UPDATE OF competition_id, round_number ON competition_rounds FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_composition();
CREATE TRIGGER set_competition_rounds_updated_at BEFORE UPDATE ON competition_rounds FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_round BEFORE INSERT OR UPDATE OF competition_id, round_number, deadline, shoot_by_date ON competition_rounds FOR EACH ROW EXECUTE FUNCTION private.validate_competition_round();
CREATE CONSTRAINT TRIGGER validate_final_competition_round_schedule AFTER INSERT OR DELETE OR UPDATE ON competition_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_final_competition_schedule();
CREATE CONSTRAINT TRIGGER check_bound_competition_average_maximum AFTER INSERT OR DELETE OR UPDATE ON competition_score_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_bound_competition_average_maximum();
CREATE CONSTRAINT TRIGGER check_series_final_state AFTER INSERT OR DELETE OR UPDATE ON competition_score_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_final_state();
CREATE TRIGGER protect_active_concurrent_competition_components BEFORE INSERT OR DELETE OR UPDATE ON competition_score_components FOR EACH ROW EXECUTE FUNCTION private.protect_active_concurrent_competition_configuration();
CREATE TRIGGER protect_published_competition_component BEFORE INSERT OR DELETE OR UPDATE ON competition_score_components FOR EACH ROW EXECUTE FUNCTION private.protect_published_competition_component();
CREATE TRIGGER protect_scored_competition_component BEFORE INSERT OR DELETE OR UPDATE ON competition_score_components FOR EACH ROW EXECUTE FUNCTION private.protect_scored_competition_component();
CREATE TRIGGER set_competition_score_components_updated_at BEFORE UPDATE ON competition_score_components FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE CONSTRAINT TRIGGER validate_final_component_shooting_details AFTER INSERT OR DELETE OR UPDATE ON competition_score_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_final_competition_shooting_details();
CREATE TRIGGER protect_concurrent_score_usage_provenance BEFORE INSERT OR DELETE OR UPDATE OF shooting_score_source_id, competition_id, competition_round_id, competition_entrant_participant_id, created_by, created_at ON competition_score_usages FOR EACH ROW EXECUTE FUNCTION private.protect_concurrent_score_usage_provenance();
CREATE TRIGGER set_competition_score_usages_updated_at BEFORE UPDATE ON competition_score_usages FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_score_usage BEFORE INSERT OR UPDATE OF shooting_score_source_id, competition_id, competition_round_id, competition_entrant_participant_id ON competition_score_usages FOR EACH ROW EXECUTE FUNCTION private.validate_competition_score_usage();
CREATE CONSTRAINT TRIGGER check_series_average_default_maximum AFTER INSERT OR DELETE OR UPDATE ON competition_series DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_average_default_maximum();
CREATE CONSTRAINT TRIGGER check_series_final_state AFTER INSERT OR UPDATE ON competition_series DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_final_state();
CREATE TRIGGER protect_series_contract BEFORE UPDATE ON competition_series FOR EACH ROW EXECUTE FUNCTION private.protect_series_contract();
CREATE TRIGGER set_competition_series_average_defaults_updated_at BEFORE UPDATE ON competition_series_average_defaults FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_competition_series_average_default BEFORE INSERT OR UPDATE ON competition_series_average_defaults FOR EACH ROW EXECUTE FUNCTION private.validate_competition_series_average_default();
CREATE CONSTRAINT TRIGGER check_series_average_default_maximum AFTER INSERT OR DELETE OR UPDATE ON competition_series_score_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_average_default_maximum();
CREATE CONSTRAINT TRIGGER check_series_final_state AFTER INSERT OR DELETE OR UPDATE ON competition_series_score_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_final_state();
CREATE TRIGGER protect_series_contract BEFORE INSERT OR DELETE OR UPDATE ON competition_series_score_components FOR EACH ROW EXECUTE FUNCTION private.protect_series_contract();
CREATE TRIGGER protect_starting_average_finalisation BEFORE UPDATE ON competition_starting_average_finalisations FOR EACH ROW EXECUTE FUNCTION private.protect_starting_average_finalisation();
CREATE CONSTRAINT TRIGGER check_bound_competition_average_maximum AFTER INSERT OR DELETE OR UPDATE ON competitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_bound_competition_average_maximum();
CREATE CONSTRAINT TRIGGER check_series_final_state AFTER INSERT OR DELETE OR UPDATE ON competitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_series_final_state();
CREATE TRIGGER copy_competition_series_average_defaults AFTER UPDATE OF competition_series_id ON competitions FOR EACH ROW EXECUTE FUNCTION private.copy_competition_series_average_defaults();
CREATE TRIGGER protect_active_concurrent_competition_configuration BEFORE UPDATE OF sets_per_round, shots_per_round, uses_x_score, shooting_details_version, equipment_type_code, organisation_equipment_type_id ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_active_concurrent_competition_configuration();
CREATE TRIGGER protect_competition_entry_shape BEFORE UPDATE OF entry_format, team_size ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_competition_entry_shape();
CREATE TRIGGER protect_published_competition_configuration BEFORE UPDATE OF entry_format, team_size, sets_per_round, shots_per_round, scoring_method, maximum_score_per_round, ranking_method, best_rounds_count, uses_x_score, number_of_rounds, shooting_details_version, equipment_type_code, organisation_equipment_type_id ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_published_competition_configuration();
CREATE TRIGGER protect_round_robin_configuration BEFORE INSERT OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_configuration();
CREATE TRIGGER protect_scored_competition_configuration BEFORE UPDATE OF sets_per_round, uses_x_score, shots_per_round ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_scored_competition_configuration();
CREATE TRIGGER protect_series_edition BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION private.protect_series_edition();
CREATE TRIGGER set_competitions_updated_at BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE CONSTRAINT TRIGGER validate_final_competition_configuration_schedule AFTER UPDATE ON competitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_final_competition_schedule();
CREATE CONSTRAINT TRIGGER validate_final_competition_shooting_details AFTER INSERT OR UPDATE ON competitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_final_competition_shooting_details();
CREATE TRIGGER protect_concurrent_shooting_group_competitions BEFORE INSERT OR DELETE OR UPDATE ON concurrent_shooting_group_competitions FOR EACH ROW EXECUTE FUNCTION private.protect_concurrent_shooting_draft_child();
CREATE TRIGGER require_concurrent_member_physical_details BEFORE INSERT OR UPDATE OF competition_id ON concurrent_shooting_group_competitions FOR EACH ROW EXECUTE FUNCTION private.require_concurrent_member_physical_details();
CREATE TRIGGER validate_concurrent_shooting_membership BEFORE INSERT OR UPDATE ON concurrent_shooting_group_competitions FOR EACH ROW EXECUTE FUNCTION private.validate_concurrent_shooting_membership();
CREATE TRIGGER protect_concurrent_shooting_group BEFORE DELETE OR UPDATE ON concurrent_shooting_groups FOR EACH ROW EXECUTE FUNCTION private.protect_concurrent_shooting_group();
CREATE TRIGGER protect_concurrent_shooting_round_mappings BEFORE INSERT OR DELETE OR UPDATE ON concurrent_shooting_round_mappings FOR EACH ROW EXECUTE FUNCTION private.protect_concurrent_shooting_draft_child();
CREATE TRIGGER protect_concurrent_shooting_rounds BEFORE INSERT OR DELETE OR UPDATE ON concurrent_shooting_rounds FOR EACH ROW EXECUTE FUNCTION private.protect_concurrent_shooting_draft_child();
CREATE TRIGGER set_concurrent_shooting_rounds_updated_at BEFORE UPDATE ON concurrent_shooting_rounds FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_competition_season_bounds BEFORE UPDATE OF entry_opens_at, entry_closes_at, starts_at, ends_at ON league_seasons FOR EACH ROW EXECUTE FUNCTION private.protect_competition_season_bounds();
CREATE TRIGGER protect_round_robin_season_start BEFORE UPDATE OF starts_at ON league_seasons FOR EACH ROW EXECUTE FUNCTION private.protect_round_robin_season_start();
CREATE TRIGGER protect_series_season_organisation BEFORE UPDATE OF organisation_id ON league_seasons FOR EACH ROW EXECUTE FUNCTION private.protect_series_season_organisation();
CREATE TRIGGER set_league_seasons_updated_at BEFORE UPDATE ON league_seasons FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_organisation_equipment_types_updated_at BEFORE UPDATE ON organisation_equipment_types FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_organisation_information_cards_updated_at BEFORE UPDATE ON organisation_information_cards FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_organisation_shooting_positions_updated_at BEFORE UPDATE ON organisation_shooting_positions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_organisation_staff_updated_at BEFORE UPDATE ON organisation_staff FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_organisations_updated_at BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION private.set_profile_updated_at();
CREATE TRIGGER prevent_shooting_score_change_event_mutation BEFORE DELETE OR UPDATE ON shooting_score_change_events FOR EACH ROW EXECUTE FUNCTION private.prevent_shooting_score_change_event_mutation();
CREATE TRIGGER validate_shooting_score_change_event BEFORE INSERT ON shooting_score_change_events FOR EACH ROW EXECUTE FUNCTION private.validate_shooting_score_change_event();
CREATE TRIGGER protect_shooting_score_source_foundation BEFORE INSERT OR UPDATE ON shooting_score_sources FOR EACH ROW EXECUTE FUNCTION private.protect_shooting_score_source_foundation();
CREATE TRIGGER protect_used_score_source_provenance BEFORE DELETE OR UPDATE ON shooting_score_sources FOR EACH ROW EXECUTE FUNCTION private.protect_used_score_source_provenance();
CREATE TRIGGER set_shooting_score_sources_updated_at BEFORE UPDATE ON shooting_score_sources FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER protect_archived_concurrent_score_value BEFORE INSERT OR DELETE OR UPDATE ON shooting_score_values FOR EACH ROW EXECUTE FUNCTION private.protect_archived_concurrent_score_value();
CREATE TRIGGER set_shooting_score_values_updated_at BEFORE UPDATE ON shooting_score_values FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER validate_shooting_score_value BEFORE INSERT OR UPDATE OF shooting_score_source_id, set_number, component_position, achieved_score ON shooting_score_values FOR EACH ROW EXECUTE FUNCTION private.validate_shooting_score_value();
CREATE CONSTRAINT TRIGGER validate_shooting_score_x_total AFTER INSERT OR UPDATE ON shooting_score_values DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_shooting_score_x_total();

alter table "public"."average_contexts" enable row level security;
alter table "public"."average_policies" enable row level security;
alter table "public"."average_policy_versions" enable row level security;
alter table "public"."club_competition_entries" enable row level security;
alter table "public"."club_information_cards" enable row level security;
alter table "public"."club_memberships" enable row level security;
alter table "public"."club_team_roster_members" enable row level security;
alter table "public"."club_teams" enable row level security;
alter table "public"."clubs" enable row level security;
alter table "public"."competition_average_settings" enable row level security;
alter table "public"."competition_division_assignments" enable row level security;
alter table "public"."competition_division_configs" enable row level security;
alter table "public"."competition_divisions" enable row level security;
alter table "public"."competition_entrant_participants" enable row level security;
alter table "public"."competition_entrants" enable row level security;
alter table "public"."competition_participant_starting_averages" enable row level security;
alter table "public"."competition_round_robin_fixtures" enable row level security;
alter table "public"."competition_rounds" enable row level security;
alter table "public"."competition_score_components" enable row level security;
alter table "public"."competition_score_usages" enable row level security;
alter table "public"."competition_series" enable row level security;
alter table "public"."competition_series_average_defaults" enable row level security;
alter table "public"."competition_series_score_components" enable row level security;
alter table "public"."competition_starting_average_finalisations" enable row level security;
alter table "public"."competitions" enable row level security;
alter table "public"."concurrent_shooting_group_competitions" enable row level security;
alter table "public"."concurrent_shooting_groups" enable row level security;
alter table "public"."concurrent_shooting_round_mappings" enable row level security;
alter table "public"."concurrent_shooting_rounds" enable row level security;
alter table "public"."league_seasons" enable row level security;
alter table "public"."organisation_equipment_types" enable row level security;
alter table "public"."organisation_information_cards" enable row level security;
alter table "public"."organisation_shooting_positions" enable row level security;
alter table "public"."organisation_staff" enable row level security;
alter table "public"."organisations" enable row level security;
alter table "public"."profiles" enable row level security;
alter table "public"."shooting_equipment_types" enable row level security;
alter table "public"."shooting_positions" enable row level security;
alter table "public"."shooting_score_change_events" enable row level security;
alter table "public"."shooting_score_sources" enable row level security;
alter table "public"."shooting_score_values" enable row level security;
alter table "public"."starting_average_score_sources" enable row level security;
alter table "public"."user_organisations" enable row level security;

create policy "Staff read Average Contexts"
  on "public"."average_contexts"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff staff
     JOIN organisations organisation ON ((organisation.id = staff.organisation_id)))
  WHERE ((staff.organisation_id = average_contexts.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Staff read Average Policies"
  on "public"."average_policies"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff staff
     JOIN organisations organisation ON ((organisation.id = staff.organisation_id)))
  WHERE ((staff.organisation_id = average_policies.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Staff read Average Policy versions"
  on "public"."average_policy_versions"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM average_policies policy
  WHERE (policy.id = average_policy_versions.average_policy_id))));
create policy "Club members can read permitted competition entries"
  on "public"."club_competition_entries"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (club_memberships membership
     JOIN clubs club ON ((club.id = membership.club_id)))
  WHERE ((membership.club_id = club_competition_entries.club_id) AND (membership.user_id = ( SELECT auth.uid() AS uid)) AND (membership.status = 'active'::text) AND (club.status = 'active'::text) AND ((membership.role = ANY (ARRAY['owner'::text, 'official'::text])) OR (club_competition_entries.status = 'submitted'::text))))));
create policy "Authenticated users can read active club information"
  on "public"."club_information_cards"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM clubs club
  WHERE ((club.id = club_information_cards.club_id) AND (club.status = 'active'::text)))));
create policy "Users can manage their own club membership lifecycle"
  on "public"."club_memberships"
  as permissive
  for update
  to "authenticated"
  using (((( SELECT auth.uid() AS uid) = user_id) AND (status = ANY (ARRAY['active'::text, 'rejected'::text, 'left'::text]))))
  with check (((( SELECT auth.uid() AS uid) = user_id) AND ((status = 'left'::text) OR ((status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM clubs
  WHERE ((clubs.id = club_memberships.club_id) AND (clubs.status = 'active'::text))))))));
create policy "Users can read their own club memberships"
  on "public"."club_memberships"
  as permissive
  for select
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users can request their own pending club membership"
  on "public"."club_memberships"
  as permissive
  for insert
  to "authenticated"
  with check (((( SELECT auth.uid() AS uid) = user_id) AND (status = 'pending'::text) AND (role = 'member'::text) AND (EXISTS ( SELECT 1
   FROM clubs
  WHERE ((clubs.id = club_memberships.club_id) AND (clubs.status = 'active'::text))))));
create policy "Active club members can read Club Team rosters"
  on "public"."club_team_roster_members"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM ((club_teams team
     JOIN club_memberships membership ON ((membership.club_id = team.club_id)))
     JOIN clubs club ON ((club.id = team.club_id)))
  WHERE ((team.id = club_team_roster_members.club_team_id) AND (membership.user_id = ( SELECT auth.uid() AS uid)) AND (membership.status = 'active'::text) AND (club.status = 'active'::text)))));
create policy "Active club members can read Club Teams"
  on "public"."club_teams"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (club_memberships membership
     JOIN clubs club ON ((club.id = membership.club_id)))
  WHERE ((membership.club_id = club_teams.club_id) AND (membership.user_id = ( SELECT auth.uid() AS uid)) AND (membership.status = 'active'::text) AND (club.status = 'active'::text)))));
create policy "Authenticated users can discover active clubs"
  on "public"."clubs"
  as permissive
  for select
  to "authenticated"
  using ((status = 'active'::text));
create policy "Staff read Competition Average settings"
  on "public"."competition_average_settings"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (((competitions competition
     JOIN league_seasons season ON ((season.id = competition.league_season_id)))
     JOIN organisation_staff staff ON ((staff.organisation_id = season.organisation_id)))
     JOIN organisations organisation ON ((organisation.id = season.organisation_id)))
  WHERE ((competition.id = competition_average_settings.competition_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Permitted users can read competition division assignments"
  on "public"."competition_division_assignments"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competition_division_configs config
  WHERE (config.competition_id = competition_division_assignments.competition_id))));
create policy "Permitted users can read competition division configs"
  on "public"."competition_division_configs"
  as permissive
  for select
  to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM (((competitions competition
     JOIN league_seasons season ON ((season.id = competition.league_season_id)))
     JOIN organisations organisation ON ((organisation.id = season.organisation_id)))
     JOIN organisation_staff staff ON ((staff.organisation_id = season.organisation_id)))
  WHERE ((competition.id = competition_division_configs.competition_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))) OR ((status = 'published'::text) AND (EXISTS ( SELECT 1
   FROM ((club_competition_entries entry
     JOIN clubs club ON ((club.id = entry.club_id)))
     JOIN club_memberships membership ON ((membership.club_id = entry.club_id)))
  WHERE ((entry.competition_id = competition_division_configs.competition_id) AND (entry.status = 'submitted'::text) AND (club.status = 'active'::text) AND (membership.user_id = ( SELECT auth.uid() AS uid)) AND (membership.status = 'active'::text) AND ((membership.role = ANY (ARRAY['owner'::text, 'official'::text])) OR (EXISTS ( SELECT 1
           FROM competition_entrant_participants participant
          WHERE ((participant.club_competition_entry_id = entry.id) AND (participant.club_membership_id = membership.id)))))))))));
create policy "Permitted users can read competition divisions"
  on "public"."competition_divisions"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competition_division_configs config
  WHERE (config.competition_id = competition_divisions.competition_id))));
create policy "Club management or entered shooter can read participants"
  on "public"."competition_entrant_participants"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (((club_competition_entries entry
     JOIN club_memberships actor_membership ON ((actor_membership.club_id = entry.club_id)))
     JOIN clubs club ON ((club.id = entry.club_id)))
     LEFT JOIN club_memberships participant_membership ON ((participant_membership.id = competition_entrant_participants.club_membership_id)))
  WHERE ((entry.id = competition_entrant_participants.club_competition_entry_id) AND (actor_membership.user_id = ( SELECT auth.uid() AS uid)) AND (actor_membership.status = 'active'::text) AND (club.status = 'active'::text) AND ((actor_membership.role = ANY (ARRAY['owner'::text, 'official'::text])) OR ((entry.status = 'submitted'::text) AND (participant_membership.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "Club members can read permitted competition entrants"
  on "public"."competition_entrants"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM ((club_competition_entries entry
     JOIN club_memberships membership ON ((membership.club_id = entry.club_id)))
     JOIN clubs club ON ((club.id = entry.club_id)))
  WHERE ((entry.id = competition_entrants.club_competition_entry_id) AND (membership.user_id = ( SELECT auth.uid() AS uid)) AND (membership.status = 'active'::text) AND (club.status = 'active'::text) AND ((membership.role = ANY (ARRAY['owner'::text, 'official'::text])) OR (entry.status = 'submitted'::text))))));
create policy "Staff read Starting Averages"
  on "public"."competition_participant_starting_averages"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (((competitions competition
     JOIN league_seasons season ON ((season.id = competition.league_season_id)))
     JOIN organisation_staff staff ON ((staff.organisation_id = season.organisation_id)))
     JOIN organisations organisation ON ((organisation.id = season.organisation_id)))
  WHERE ((competition.id = competition_participant_starting_averages.competition_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Authenticated users can read visible competition rounds"
  on "public"."competition_rounds"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competitions competition
  WHERE (competition.id = competition_rounds.competition_id))));
create policy "Authenticated users can read visible competition score componen"
  on "public"."competition_score_components"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competitions competition
  WHERE (competition.id = competition_score_components.competition_id))));
create policy "Staff read Competition Series"
  on "public"."competition_series"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff s
     JOIN organisations o ON ((o.id = s.organisation_id)))
  WHERE ((s.organisation_id = competition_series.organisation_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.status = 'active'::text) AND (s.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (o.status = 'active'::text)))));
create policy "Staff read Series Average defaults"
  on "public"."competition_series_average_defaults"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competition_series series
  WHERE (series.id = competition_series_average_defaults.competition_series_id))));
create policy "Staff read Series components"
  on "public"."competition_series_score_components"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competition_series s
  WHERE (s.id = competition_series_score_components.competition_series_id))));
create policy "Authenticated users can read visible competitions"
  on "public"."competitions"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (league_seasons season
     JOIN organisations organisation ON ((organisation.id = season.organisation_id)))
  WHERE ((season.id = competitions.league_season_id) AND (organisation.status = 'active'::text) AND (((competitions.status = 'published'::text) AND (season.status = ANY (ARRAY['open'::text, 'active'::text, 'completed'::text]))) OR (EXISTS ( SELECT 1
           FROM organisation_staff staff
          WHERE ((staff.organisation_id = season.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.role = 'owner'::text) AND (staff.status = 'active'::text)))))))));
create policy "Managers read draft Competitions"
  on "public"."competitions"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM ((league_seasons season
     JOIN organisation_staff s ON ((s.organisation_id = season.organisation_id)))
     JOIN organisations o ON ((o.id = s.organisation_id)))
  WHERE ((season.id = competitions.league_season_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.status = 'active'::text) AND (s.role = 'manager'::text) AND (o.status = 'active'::text)))));
create policy "Authenticated users can read visible league seasons"
  on "public"."league_seasons"
  as permissive
  for select
  to "authenticated"
  using (((status = ANY (ARRAY['open'::text, 'active'::text, 'completed'::text])) OR (EXISTS ( SELECT 1
   FROM organisation_staff staff
  WHERE ((staff.organisation_id = league_seasons.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.role = 'owner'::text) AND (staff.status = 'active'::text))))));
create policy "Managers read draft Seasons"
  on "public"."league_seasons"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff s
     JOIN organisations o ON ((o.id = s.organisation_id)))
  WHERE ((s.organisation_id = league_seasons.organisation_id) AND (s.user_id = ( SELECT auth.uid() AS uid)) AND (s.status = 'active'::text) AND (s.role = 'manager'::text) AND (o.status = 'active'::text)))));
create policy "Contextual staff read custom equipment"
  on "public"."organisation_equipment_types"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff staff
     JOIN organisations organisation ON ((organisation.id = staff.organisation_id)))
  WHERE ((staff.organisation_id = organisation_equipment_types.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Authenticated users can read active organisation information"
  on "public"."organisation_information_cards"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM organisations organisation
  WHERE ((organisation.id = organisation_information_cards.organisation_id) AND (organisation.status = 'active'::text)))));
create policy "Contextual staff read custom positions"
  on "public"."organisation_shooting_positions"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM (organisation_staff staff
     JOIN organisations organisation ON ((organisation.id = staff.organisation_id)))
  WHERE ((staff.organisation_id = organisation_shooting_positions.organisation_id) AND (staff.user_id = ( SELECT auth.uid() AS uid)) AND (staff.status = 'active'::text) AND (staff.role = ANY (ARRAY['owner'::text, 'manager'::text])) AND (organisation.status = 'active'::text)))));
create policy "Users can read their own organisation staff access"
  on "public"."organisation_staff"
  as permissive
  for select
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Authenticated users can discover active organisations"
  on "public"."organisations"
  as permissive
  for select
  to "authenticated"
  using ((status = 'active'::text));
create policy "Users can read their own profile"
  on "public"."profiles"
  as permissive
  for select
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = id));
create policy "Users can update their own profile"
  on "public"."profiles"
  as permissive
  for update
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = id))
  with check ((( SELECT auth.uid() AS uid) = id));
create policy "Authenticated read built-in equipment"
  on "public"."shooting_equipment_types"
  as permissive
  for select
  to "authenticated"
  using (true);
create policy "Authenticated read built-in positions"
  on "public"."shooting_positions"
  as permissive
  for select
  to "authenticated"
  using (true);
create policy "Staff read Starting Average provenance"
  on "public"."starting_average_score_sources"
  as permissive
  for select
  to "authenticated"
  using ((EXISTS ( SELECT 1
   FROM competition_participant_starting_averages snapshot
  WHERE (snapshot.id = starting_average_score_sources.starting_average_id))));
create policy "Users can add active organisations to their own dashboard"
  on "public"."user_organisations"
  as permissive
  for insert
  to "authenticated"
  with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM organisations
  WHERE ((organisations.id = user_organisations.organisation_id) AND (organisations.status = 'active'::text))))));
create policy "Users can read their own dashboard organisations"
  on "public"."user_organisations"
  as permissive
  for select
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users can remove organisations from their own dashboard"
  on "public"."user_organisations"
  as permissive
  for delete
  to "authenticated"
  using ((( SELECT auth.uid() AS uid) = user_id));

grant select on table "public"."average_contexts" to "authenticated";
grant select on table "public"."average_policies" to "authenticated";
grant select on table "public"."average_policy_versions" to "authenticated";
grant select on table "public"."club_memberships" to "authenticated";
grant select on table "public"."competition_average_settings" to "authenticated";
grant select on table "public"."competition_division_assignments" to "authenticated";
grant select on table "public"."competition_divisions" to "authenticated";
grant select on table "public"."competition_participant_starting_averages" to "authenticated";
grant select on table "public"."competition_series" to "authenticated";
grant select on table "public"."competition_series_average_defaults" to "authenticated";
grant select on table "public"."competition_series_score_components" to "authenticated";
grant select on table "public"."organisation_equipment_types" to "authenticated";
grant select on table "public"."organisation_shooting_positions" to "authenticated";
grant select on table "public"."organisation_staff" to "authenticated";
grant select on table "public"."profiles" to "authenticated";
grant select on table "public"."shooting_equipment_types" to "authenticated";
grant select on table "public"."shooting_positions" to "authenticated";
grant select on table "public"."starting_average_score_sources" to "authenticated";
grant delete on table "public"."user_organisations" to "authenticated";
grant select on table "public"."user_organisations" to "authenticated";
grant select ("id", "competition_id", "club_id", "status", "submitted_at", "created_at", "updated_at") on table "public"."club_competition_entries" to "authenticated";
grant select ("id", "club_id", "title", "content", "position", "created_at", "updated_at") on table "public"."club_information_cards" to "authenticated";
grant insert ("club_id", "user_id") on table "public"."club_memberships" to "authenticated";
grant update ("status") on table "public"."club_memberships" to "authenticated";
grant select ("club_team_id", "position", "club_membership_id", "created_at") on table "public"."club_team_roster_members" to "authenticated";
grant select ("id", "club_id", "name", "display_order", "archived_at", "created_at", "updated_at", "unit_type", "fixed_size") on table "public"."club_teams" to "authenticated";
grant select ("id", "name", "slug", "town", "county", "postcode", "website", "status", "created_at", "updated_at", "search_document", "about_content") on table "public"."clubs" to "authenticated";
grant select ("competition_id", "target_size", "status", "published_at", "created_at", "updated_at") on table "public"."competition_division_configs" to "authenticated";
grant select ("id", "club_competition_entry_id", "competition_entrant_id", "club_membership_id", "slot_number", "created_at", "updated_at") on table "public"."competition_entrant_participants" to "authenticated";
grant select ("id", "club_competition_entry_id", "position", "created_at", "updated_at") on table "public"."competition_entrants" to "authenticated";
grant select ("id", "competition_id", "round_number", "deadline", "created_at", "updated_at", "shoot_by_date") on table "public"."competition_rounds" to "authenticated";
grant select ("id", "competition_id", "position", "short_label", "maximum_score", "score_method", "created_at", "updated_at", "shooting_position_mode", "shooting_position_code", "organisation_shooting_position_id", "distance_mode", "distance_value", "distance_unit", "shots") on table "public"."competition_score_components" to "authenticated";
grant select ("id", "league_season_id", "name", "slug", "description", "status", "entry_format", "team_size", "scoring_method", "maximum_score_per_round", "shots_per_round", "uses_x_score", "number_of_rounds", "entry_fee", "created_at", "updated_at", "entry_window_mode", "custom_entry_opens_at", "custom_entry_closes_at", "start_date_mode", "custom_starts_at", "sets_per_round", "ranking_method", "best_rounds_count", "local_scoring_enabled", "competition_series_id", "shooting_details_version", "equipment_type_code", "organisation_equipment_type_id") on table "public"."competitions" to "authenticated";
grant select ("id", "organisation_id", "name", "description", "slug", "status", "entry_opens_at", "entry_closes_at", "starts_at", "ends_at", "created_at", "updated_at") on table "public"."league_seasons" to "authenticated";
grant select ("id", "organisation_id", "title", "content", "position", "created_at", "updated_at") on table "public"."organisation_information_cards" to "authenticated";
grant select ("id", "name", "slug", "short_name", "description", "website", "contact_email", "status", "created_at", "updated_at", "search_document", "organisation_type", "address", "postcode", "telephone", "about_content") on table "public"."organisations" to "authenticated";
grant update ("first_name", "last_name", "title", "address", "town", "county", "postcode", "phone_number") on table "public"."profiles" to "authenticated";
grant insert ("user_id", "organisation_id") on table "public"."user_organisations" to "authenticated";

revoke all privileges on function "private"."apply_competition_shooting_details"(p_organisation_id bigint, p_competition_id bigint, p_configuration jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."average_context_competition_history"(p_average_context_id bigint, p_before_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."block_starting_average_after_finalisation"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."check_bound_competition_average_maximum"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."check_competition_configuration_keys"(p_values jsonb, p_identity boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."check_series_average_default_maximum"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."check_series_final_state"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."clean_shooting_term"(p_value text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."club_team_management_json"(p_club_team_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_average_shooter_maximum"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_components"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_configuration_version"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_entrant_label"(p_entry_format text, p_position integer, p_club_team_name_snapshot text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_has_complete_shooting_details"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_has_participation"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_series_average_shooter_maximum"(p_competition_series_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_series_components"(p_series_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."competition_starting_average_state"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."concurrent_shooting_compatibility_mismatches"(p_reference jsonb, p_candidate jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."concurrent_shooting_compatibility_signature"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."concurrent_shooting_participant_metadata"(p_concurrent_shooting_round_id bigint, p_shooter_profile_id uuid, p_access_scope text, p_scoped_club_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."copy_competition_series_average_defaults"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."derive_competition_round_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint, p_released_only boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."enforce_authenticated_membership_transition"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."freeze_competition_starting_averages"(p_competition_id bigint, p_actor_id uuid, p_require_division_review boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."generate_round_robin_fixtures"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."get_club_competition_entry_mutation_context"(p_club_competition_entry_id bigint, p_require_open boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."get_competition_effective_dates"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."get_individual_competition_score_entry_base"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."handle_new_user_profile"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."normalise_club_team_name"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."normalise_shooting_term"(p_value text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."prevent_shooting_score_change_event_mutation"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_active_concurrent_competition_configuration"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_archived_concurrent_score_value"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_average_context_basis"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_average_policy_version"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_club_team_type_size"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_competition_average_setting"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_competition_entry_shape"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_competition_season_bounds"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_concurrent_score_usage_provenance"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_concurrent_shooting_draft_child"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_concurrent_shooting_group"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_draft_entry_from_archived_team"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_frozen_starting_average"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_published_competition_component"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_published_competition_configuration"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_round_robin_composition"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_round_robin_configuration"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_round_robin_season_start"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_scored_competition_component"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_scored_competition_configuration"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_scored_competition_entry"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_series_contract"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_series_edition"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_series_season_organisation"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_shooting_score_source_foundation"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_starting_average_finalisation"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."protect_used_score_source_provenance"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."reconcile_concurrent_shooting_entry"(p_club_competition_entry_id bigint, p_actor_id uuid) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."reconcile_concurrent_shooting_entry_trigger"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."record_competition_starting_average_review"(p_competition_id bigint, p_fingerprint text, p_actor_id uuid) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_club_team_member"(p_club_id bigint, p_require_manager boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_competition_author"(p_organisation_id bigint, p_owner_only boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_competition_division_manager"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_competition_lifecycle_owner"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_competition_results_context"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_concurrent_member_physical_details"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_owner_only boolean, p_required_status text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_concurrent_shooting_targets"(p_organisation_id bigint, p_league_season_id bigint, p_concurrent_shooting_round_id bigint, p_shooter_profile_id uuid, p_shooting_score_source_id bigint, p_access_scope text, p_scoped_club_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."require_individual_score_entry_context"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."resolve_competition_starting_average"(p_target_competition_id bigint, p_shooter_profile_id uuid) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."resolve_organisation_equipment_type"(p_organisation_id bigint, p_existing_id bigint, p_new_name text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."resolve_organisation_shooting_position"(p_organisation_id bigint, p_existing_id bigint, p_new_name text) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."round_robin_division_lifecycle"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."round_robin_pairings"(p_entrants bigint[], p_rounds integer) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."save_individual_competition_round_scores_base"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."save_series_competition"(p_organisation_id bigint, p_season_id bigint, p_values jsonb, p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."set_profile_updated_at"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."set_updated_at"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."shooter_historical_average_candidates"(p_average_context_id bigint, p_shooter_profile_id uuid, p_before_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."shooting_score_source_state"(p_shooting_score_source_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."sync_provisional_competition_series"(p_competition_id bigint) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_average_policy_version_definition"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_club_team_roster_complete"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_club_team_roster_member"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_average_setting"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_configuration"(p_status text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_effective_entry_opens_at date, p_effective_entry_closes_at date, p_effective_starts_at date, p_season_ends_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[]) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_division_assignment"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_entrant_club_team"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_entry_participant"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_round"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_score_batch"(p_competition_id bigint, p_club_id bigint, p_sets_per_round integer, p_uses_x_score boolean, p_shots_per_round integer, p_scores jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_score_usage"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_series"(p_series_id bigint, p_finalise boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_series_average_default"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_competition_shooting_details"(p_competition_id bigint, p_require_complete boolean) from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_concurrent_shooting_membership"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_final_competition_schedule"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_final_competition_shooting_details"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_shooting_score_change_event"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_shooting_score_value"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_shooting_score_x_total"() from public, anon, authenticated, service_role;
revoke all privileges on function "private"."validate_starting_average_snapshot"() from public, anon, authenticated, service_role;
revoke all privileges on function "public"."activate_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."activate_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."add_concurrent_shooting_group_competition"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."add_concurrent_shooting_group_competition"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."add_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."add_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint) to "authenticated";
revoke all privileges on function "public"."archive_club_team"(p_club_team_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."archive_club_team"(p_club_team_id bigint) to "authenticated";
revoke all privileges on function "public"."archive_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."archive_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."calculate_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."calculate_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."cancel_concurrent_shooting_group_activation"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."cancel_concurrent_shooting_group_activation"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."continue_competition_series"(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_configuration_source_competition_id bigint, p_expected_source_version text, p_edition_values jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."continue_competition_series"(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_configuration_source_competition_id bigint, p_expected_source_version text, p_edition_values jsonb) to "authenticated";
revoke all privileges on function "public"."create_average_context"(p_organisation_id bigint, p_name text, p_basis_maximum numeric) from public, anon, authenticated, service_role;
grant execute on function "public"."create_average_context"(p_organisation_id bigint, p_name text, p_basis_maximum numeric) to "authenticated";
revoke all privileges on function "public"."create_average_policy"(p_organisation_id bigint, p_name text, p_strategy text, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."create_average_policy"(p_organisation_id bigint, p_name text, p_strategy text, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."create_average_policy_version"(p_organisation_id bigint, p_average_policy_id bigint, p_strategy text, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."create_average_policy_version"(p_organisation_id bigint, p_average_policy_id bigint, p_strategy text, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."create_club_information_card"(p_club_id bigint, p_title text, p_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."create_club_information_card"(p_club_id bigint, p_title text, p_content text) to "authenticated";
revoke all privileges on function "public"."create_club_team"(p_club_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[]) from public, anon, authenticated, service_role;
grant execute on function "public"."create_club_team"(p_club_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[]) to "authenticated";
revoke all privileges on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[]) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[]) to "authenticated";
revoke all privileges on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[]) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[]) to "authenticated";
revoke all privileges on function "public"."create_competition_series"(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition_series"(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."create_competition_series_with_average_defaults"(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition_series_with_average_defaults"(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint) to "authenticated";
revoke all privileges on function "public"."create_competition_with_average_settings"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition_with_average_settings"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint) to "authenticated";
revoke all privileges on function "public"."create_competition_with_shooting_details"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."create_competition_with_shooting_details"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."create_concurrent_shooting_group"(p_organisation_id bigint, p_league_season_id bigint, p_name text) from public, anon, authenticated, service_role;
grant execute on function "public"."create_concurrent_shooting_group"(p_organisation_id bigint, p_league_season_id bigint, p_name text) to "authenticated";
revoke all privileges on function "public"."create_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_position integer, p_label text) from public, anon, authenticated, service_role;
grant execute on function "public"."create_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_position integer, p_label text) to "authenticated";
revoke all privileges on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date) from public, anon, authenticated, service_role;
grant execute on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date) to "authenticated";
revoke all privileges on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_description text) from public, anon, authenticated, service_role;
grant execute on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_description text) to "authenticated";
revoke all privileges on function "public"."create_organisation_information_card"(p_organisation_id bigint, p_title text, p_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."create_organisation_information_card"(p_organisation_id bigint, p_title text, p_content text) to "authenticated";
revoke all privileges on function "public"."delete_club_information_card"(p_club_id bigint, p_card_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_club_information_card"(p_club_id bigint, p_card_id bigint) to "authenticated";
revoke all privileges on function "public"."delete_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."delete_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint) to "authenticated";
revoke all privileges on function "public"."delete_draft_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_draft_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."delete_empty_competition_series"(p_organisation_id bigint, p_competition_series_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_empty_competition_series"(p_organisation_id bigint, p_competition_series_id bigint) to "authenticated";
revoke all privileges on function "public"."delete_organisation_information_card"(p_organisation_id bigint, p_card_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."delete_organisation_information_card"(p_organisation_id bigint, p_card_id bigint) to "authenticated";
revoke all privileges on function "public"."edit_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."edit_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."finalise_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."finalise_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_club_competition_entries"(p_club_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_club_competition_entries"(p_club_id bigint) to "authenticated";
revoke all privileges on function "public"."get_club_competition_entry_management"(p_club_competition_entry_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_club_competition_entry_management"(p_club_competition_entry_id bigint) to "authenticated";
revoke all privileges on function "public"."get_club_members"(p_club_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_club_members"(p_club_id bigint) to "authenticated";
revoke all privileges on function "public"."get_club_operational_summaries"(p_club_id bigint, p_warning_days integer) from public, anon, authenticated, service_role;
grant execute on function "public"."get_club_operational_summaries"(p_club_id bigint, p_warning_days integer) to "authenticated";
revoke all privileges on function "public"."get_club_teams"(p_club_id bigint, p_include_archived boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."get_club_teams"(p_club_id bigint, p_include_archived boolean) to "authenticated";
revoke all privileges on function "public"."get_competition_aggregate_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_aggregate_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_aggregate_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_best_n_average_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_best_n_average_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_best_n_average_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_club_entry_context"(p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_club_entry_context"(p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_concurrent_shooting_summary"(p_organisation_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_concurrent_shooting_summary"(p_organisation_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_division_average_projection"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_division_average_projection"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_division_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_division_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_gun_score_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_gun_score_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_gun_score_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_lifecycle_state"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_lifecycle_state"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_result_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_result_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_result_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_round_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_round_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_round_robin_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_round_robin_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_round_robin_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_series_sources"(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_target_starts_at date) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_series_sources"(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_target_starts_at date) to "authenticated";
revoke all privileges on function "public"."get_competition_shooting_display"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_shooting_display"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "anon";
grant execute on function "public"."get_competition_shooting_display"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_competition_starting_average_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_competition_starting_average_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."get_concurrent_shooting_competition_candidates"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_concurrent_shooting_competition_candidates"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."get_concurrent_shooting_group_lifecycle"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_concurrent_shooting_group_lifecycle"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."get_concurrent_shooting_group_management"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_concurrent_shooting_group_management"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."get_individual_competition_score_entry"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_individual_competition_score_entry"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) to "authenticated";
revoke all privileges on function "public"."get_my_organisations"() from public, anon, authenticated, service_role;
grant execute on function "public"."get_my_organisations"() to "authenticated";
revoke all privileges on function "public"."get_my_shooter_analytics"(p_season_id bigint, p_equipment_kind text, p_equipment_code text, p_equipment_custom_id bigint, p_position_mode text, p_position_code text, p_position_custom_id bigint, p_distance_mode text, p_distance_value numeric, p_distance_unit text, p_history_page integer, p_include_if_seeded_today boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."get_my_shooter_analytics"(p_season_id bigint, p_equipment_kind text, p_equipment_code text, p_equipment_custom_id bigint, p_position_mode text, p_position_code text, p_position_custom_id bigint, p_distance_mode text, p_distance_value numeric, p_distance_unit text, p_history_page integer, p_include_if_seeded_today boolean) to "authenticated";
revoke all privileges on function "public"."get_my_shooting_competitions"() from public, anon, authenticated, service_role;
grant execute on function "public"."get_my_shooting_competitions"() to "authenticated";
revoke all privileges on function "public"."get_organisation_staff"(p_organisation_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_organisation_staff"(p_organisation_id bigint) to "authenticated";
revoke all privileges on function "public"."get_public_club_results_catalog"(p_club_slug text, p_query text, p_offset integer, p_limit integer) from public, anon, authenticated, service_role;
grant execute on function "public"."get_public_club_results_catalog"(p_club_slug text, p_query text, p_offset integer, p_limit integer) to "anon";
grant execute on function "public"."get_public_club_results_catalog"(p_club_slug text, p_query text, p_offset integer, p_limit integer) to "authenticated";
revoke all privileges on function "public"."get_public_results_catalog"(p_organisation_slug text, p_season_slug text, p_competition_slug text, p_query text, p_offset integer, p_limit integer) from public, anon, authenticated, service_role;
grant execute on function "public"."get_public_results_catalog"(p_organisation_slug text, p_season_slug text, p_competition_slug text, p_query text, p_offset integer, p_limit integer) to "anon";
grant execute on function "public"."get_public_results_catalog"(p_organisation_slug text, p_season_slug text, p_competition_slug text, p_query text, p_offset integer, p_limit integer) to "authenticated";
revoke all privileges on function "public"."get_published_competition_divisions"(p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."get_published_competition_divisions"(p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."list_concurrent_shooting_groups"(p_organisation_id bigint, p_league_season_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."list_concurrent_shooting_groups"(p_organisation_id bigint, p_league_season_id bigint) to "authenticated";
revoke all privileges on function "public"."map_matching_concurrent_shooting_round_numbers"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."map_matching_concurrent_shooting_round_numbers"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) to "authenticated";
revoke all privileges on function "public"."process_club_membership_request"(p_membership_id bigint, p_decision text) from public, anon, authenticated, service_role;
grant execute on function "public"."process_club_membership_request"(p_membership_id bigint, p_decision text) to "authenticated";
revoke all privileges on function "public"."process_organisation_management_request"(p_staff_id bigint, p_decision text) from public, anon, authenticated, service_role;
grant execute on function "public"."process_organisation_management_request"(p_staff_id bigint, p_decision text) to "authenticated";
revoke all privileges on function "public"."publish_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."publish_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."reconcile_concurrent_shooting_entry"(p_organisation_id bigint, p_club_competition_entry_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."reconcile_concurrent_shooting_entry"(p_organisation_id bigint, p_club_competition_entry_id bigint) to "authenticated";
revoke all privileges on function "public"."register_club"(p_name text, p_town text, p_county text, p_postcode text, p_website text) from public, anon, authenticated, service_role;
grant execute on function "public"."register_club"(p_name text, p_town text, p_county text, p_postcode text, p_website text) to "authenticated";
revoke all privileges on function "public"."register_organisation"(p_name text, p_short_name text, p_organisation_type text, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) from public, anon, authenticated, service_role;
grant execute on function "public"."register_organisation"(p_name text, p_short_name text, p_organisation_type text, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) to "authenticated";
revoke all privileges on function "public"."remove_concurrent_shooting_group_competition"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."remove_concurrent_shooting_group_competition"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."remove_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."remove_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."remove_organisation_manager_access"(p_staff_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."remove_organisation_manager_access"(p_staff_id bigint) to "authenticated";
revoke all privileges on function "public"."rename_club_team"(p_club_team_id bigint, p_name text) from public, anon, authenticated, service_role;
grant execute on function "public"."rename_club_team"(p_club_team_id bigint, p_name text) to "authenticated";
revoke all privileges on function "public"."rename_competition_series"(p_organisation_id bigint, p_competition_series_id bigint, p_name text) from public, anon, authenticated, service_role;
grant execute on function "public"."rename_competition_series"(p_organisation_id bigint, p_competition_series_id bigint, p_name text) to "authenticated";
revoke all privileges on function "public"."rename_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_name text) from public, anon, authenticated, service_role;
grant execute on function "public"."rename_concurrent_shooting_group"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_name text) to "authenticated";
revoke all privileges on function "public"."reorder_club_information_cards"(p_club_id bigint, p_card_ids bigint[]) from public, anon, authenticated, service_role;
grant execute on function "public"."reorder_club_information_cards"(p_club_id bigint, p_card_ids bigint[]) to "authenticated";
revoke all privileges on function "public"."reorder_organisation_information_cards"(p_organisation_id bigint, p_card_ids bigint[]) from public, anon, authenticated, service_role;
grant execute on function "public"."reorder_organisation_information_cards"(p_organisation_id bigint, p_card_ids bigint[]) to "authenticated";
revoke all privileges on function "public"."request_organisation_management_access"(p_organisation_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."request_organisation_management_access"(p_organisation_id bigint) to "authenticated";
revoke all privileges on function "public"."return_competition_to_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."return_competition_to_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) to "authenticated";
revoke all privileges on function "public"."save_and_publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."save_and_publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) to "authenticated";
revoke all privileges on function "public"."save_and_publish_competition_divisions_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) from public, anon, authenticated, service_role;
grant execute on function "public"."save_and_publish_competition_divisions_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) to "authenticated";
revoke all privileges on function "public"."save_and_submit_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."save_and_submit_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) to "authenticated";
revoke all privileges on function "public"."save_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."save_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) to "authenticated";
revoke all privileges on function "public"."save_competition_division_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."save_competition_division_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) to "authenticated";
revoke all privileges on function "public"."save_competition_division_draft_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) from public, anon, authenticated, service_role;
grant execute on function "public"."save_competition_division_draft_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) to "authenticated";
revoke all privileges on function "public"."save_individual_competition_round_scores"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."save_individual_competition_round_scores"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb) to "authenticated";
revoke all privileges on function "public"."search_club_competition_entry_members"(p_club_competition_entry_id bigint, p_query text, p_limit integer) from public, anon, authenticated, service_role;
grant execute on function "public"."search_club_competition_entry_members"(p_club_competition_entry_id bigint, p_query text, p_limit integer) to "authenticated";
revoke all privileges on function "public"."set_average_context_archived"(p_organisation_id bigint, p_average_context_id bigint, p_archived boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."set_average_context_archived"(p_organisation_id bigint, p_average_context_id bigint, p_archived boolean) to "authenticated";
revoke all privileges on function "public"."set_average_policy_archived"(p_organisation_id bigint, p_average_policy_id bigint, p_archived boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."set_average_policy_archived"(p_organisation_id bigint, p_average_policy_id bigint, p_archived boolean) to "authenticated";
revoke all privileges on function "public"."set_club_member_role"(p_membership_id bigint, p_role text) from public, anon, authenticated, service_role;
grant execute on function "public"."set_club_member_role"(p_membership_id bigint, p_role text) to "authenticated";
revoke all privileges on function "public"."set_competition_average_settings"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint, p_contributes_to_history boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."set_competition_average_settings"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint, p_contributes_to_history boolean) to "authenticated";
revoke all privileges on function "public"."set_competition_series_archived"(p_organisation_id bigint, p_competition_series_id bigint, p_archived boolean) from public, anon, authenticated, service_role;
grant execute on function "public"."set_competition_series_archived"(p_organisation_id bigint, p_competition_series_id bigint, p_archived boolean) to "authenticated";
revoke all privileges on function "public"."set_competition_series_average_defaults"(p_organisation_id bigint, p_competition_series_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."set_competition_series_average_defaults"(p_organisation_id bigint, p_competition_series_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint) to "authenticated";
revoke all privileges on function "public"."set_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."set_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint) to "authenticated";
revoke all privileges on function "public"."set_manual_competition_starting_average"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_entrant_participant_id bigint, p_starting_average numeric, p_manual_reason text) from public, anon, authenticated, service_role;
grant execute on function "public"."set_manual_competition_starting_average"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_entrant_participant_id bigint, p_starting_average numeric, p_manual_reason text) to "authenticated";
revoke all privileges on function "public"."start_club_competition_entry"(p_competition_id bigint, p_club_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."start_club_competition_entry"(p_competition_id bigint, p_club_id bigint) to "authenticated";
revoke all privileges on function "public"."submit_club_competition_entry"(p_club_competition_entry_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."submit_club_competition_entry"(p_club_competition_entry_id bigint) to "authenticated";
revoke all privileges on function "public"."transfer_club_ownership"(p_club_id bigint, p_target_membership_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."transfer_club_ownership"(p_club_id bigint, p_target_membership_id bigint) to "authenticated";
revoke all privileges on function "public"."transfer_organisation_ownership"(p_organisation_id bigint, p_target_staff_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."transfer_organisation_ownership"(p_organisation_id bigint, p_target_staff_id bigint) to "authenticated";
revoke all privileges on function "public"."unarchive_club_team"(p_club_team_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."unarchive_club_team"(p_club_team_id bigint) to "authenticated";
revoke all privileges on function "public"."update_club_about"(p_club_id bigint, p_about_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_club_about"(p_club_id bigint, p_about_content text) to "authenticated";
revoke all privileges on function "public"."update_club_details"(p_club_id bigint, p_name text, p_town text, p_county text, p_postcode text, p_website text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_club_details"(p_club_id bigint, p_name text, p_town text, p_county text, p_postcode text, p_website text) to "authenticated";
revoke all privileges on function "public"."update_club_information_card"(p_club_id bigint, p_card_id bigint, p_title text, p_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_club_information_card"(p_club_id bigint, p_card_id bigint, p_title text, p_content text) to "authenticated";
revoke all privileges on function "public"."update_club_team"(p_club_team_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[]) from public, anon, authenticated, service_role;
grant execute on function "public"."update_club_team"(p_club_team_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[]) to "authenticated";
revoke all privileges on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[], p_status text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[], p_status text) to "authenticated";
revoke all privileges on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[], p_status text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[], p_status text) to "authenticated";
revoke all privileges on function "public"."update_competition_series_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."update_competition_series_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."update_competition_shooting_details_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb) from public, anon, authenticated, service_role;
grant execute on function "public"."update_competition_shooting_details_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb) to "authenticated";
revoke all privileges on function "public"."update_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_position integer, p_label text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_concurrent_shooting_round"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_position integer, p_label text) to "authenticated";
revoke all privileges on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text) to "authenticated";
revoke all privileges on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text, p_description text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text, p_description text) to "authenticated";
revoke all privileges on function "public"."update_organisation_about"(p_organisation_id bigint, p_about_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_organisation_about"(p_organisation_id bigint, p_about_content text) to "authenticated";
revoke all privileges on function "public"."update_organisation_contact_details"(p_organisation_id bigint, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_organisation_contact_details"(p_organisation_id bigint, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) to "authenticated";
revoke all privileges on function "public"."update_organisation_information_card"(p_organisation_id bigint, p_card_id bigint, p_title text, p_content text) from public, anon, authenticated, service_role;
grant execute on function "public"."update_organisation_information_card"(p_organisation_id bigint, p_card_id bigint, p_title text, p_content text) to "authenticated";
revoke all privileges on function "public"."withdraw_club_competition_entry"(p_club_competition_entry_id bigint) from public, anon, authenticated, service_role;
grant execute on function "public"."withdraw_club_competition_entry"(p_club_competition_entry_id bigint) to "authenticated";

comment on table "public"."average_contexts" is 'Explicit organisation-owned shooter-average compatibility pool. V1 compatibility is exact basis maximum only and is never inferred from Series or names.';
comment on table "public"."average_policies" is 'Organisation-owned named Starting Average policy identity. Calculation definitions live in immutable versions.';
comment on table "public"."average_policy_versions" is 'Immutable versioned Starting Average calculation definition. V1 supports manual and current_then_preceding.';
comment on table "public"."club_competition_entries" is 'One durable club-level submission for one competition. Only active club owners and officials may mutate it.';
comment on column "public"."club_competition_entries"."status" is 'Lifecycle: draft, submitted, or withdrawn. Editing submitted composition returns the entry to draft.';
comment on table "public"."club_information_cards" is 'Optional owner-authored public long-form information cards for a club. Content is constrained Markdown, not HTML.';
comment on column "public"."club_information_cards"."position" is 'Dense, one-based public display order. The 1-5 check plus per-club uniqueness enforces at most five cards.';
comment on table "public"."club_memberships" is 'One user profile association with one club, including its lifecycle state and club-contextual role.';
comment on table "public"."club_team_roster_members" is 'Current persistent Club Pair/Team roster. Edition-local Competition participant rows remain the historical record.';
comment on table "public"."club_teams" is 'Persistent Club-owned Pair/Team identity with a current roster. Competition entrants retain edition-local historical participant snapshots.';
comment on column "public"."club_teams"."name" is 'Current editable Pair/Team name. Submitted entrants retain an edition-specific name snapshot.';
comment on column "public"."club_teams"."archived_at" is 'Archived units remain available to historical entrant and Results projections but cannot be selected for a new draft entrant.';
comment on column "public"."club_teams"."unit_type" is 'Persistent unit type: pair or team. NULL marks an existing V1 identity that still needs manager setup.';
comment on column "public"."club_teams"."fixed_size" is 'Immutable roster size after setup. Pair is exactly 2; Team is between 3 and 20.';
comment on table "public"."clubs" is 'Public discovery information for rifle clubs; authenticated officials manage approved fields through a scoped function.';
comment on column "public"."clubs"."about_content" is 'The club''s single public long-form About document, stored as constrained Markdown rather than HTML.';
comment on table "public"."competition_average_settings" is 'Authoritative per-edition Average Context, immutable Policy version, and history-contribution decision. Series membership is not compatibility.';
comment on table "public"."competition_division_assignments" is 'Assigns one existing entrant unit atomically to at most one division. Participant names remain sourced from entrant participants and profiles.';
comment on table "public"."competition_division_configs" is 'Competition-scoped manual division workflow. Target size is a planning aid measured in entrant units.';
comment on column "public"."competition_division_configs"."reviewed_starting_average_fingerprint" is 'Opaque fingerprint of the participant-owned S/Av state last reviewed with this draft; never a Pair/Team historical average.';
comment on table "public"."competition_divisions" is 'Ordered division containers for one competition. Names are organiser-controlled and bounded.';
comment on table "public"."competition_entrant_participants" is 'Shooter slots for Individual, Pair, and Team entrant units. Membership status changes do not delete historical participation.';
comment on table "public"."competition_entrants" is 'One competitive unit inside a club submission. Its required size is derived from the parent competition.';
comment on column "public"."competition_entrants"."club_team_id" is 'Optional persistent Club Pair/Team identity for matching Pair/Team entrants. NULL preserves legacy and intentionally unlinked entrants.';
comment on column "public"."competition_entrants"."club_team_name_snapshot" is 'Database-derived edition display name. Draft saves refresh it; submitted historical display is unaffected by later Team renames.';
comment on table "public"."competition_participant_starting_averages" is 'Starting Average snapshot owned by one submitted Competition entrant participant, never a global shooter value.';
comment on column "public"."competition_participant_starting_averages"."starting_average" is 'Participant S/Av, or NULL only for an explicit no_history snapshot. No snapshot means calculation has not resolved the participant.';
comment on column "public"."competition_participant_starting_averages"."origin" is 'calculated, manual, or no_history. no_history is a valid reviewed null and is never converted to zero.';
comment on table "public"."competition_round_robin_fixtures" is 'Published entrant-unit schedule only. Stable identity is competition/division/round/match_number. No scores, winners or points stored. Access through the narrow Results RPC.';
comment on table "public"."competition_rounds" is 'Explicit competition round deadlines. A row contains no entry, score, result, or round-opening state.';
comment on column "public"."competition_rounds"."deadline" is 'Legacy deadline column retained as the authoritative Round End date.';
comment on column "public"."competition_rounds"."shoot_by_date" is 'Optional local/club scoring cutoff. When null, the Round End date is the future local cutoff.';
comment on table "public"."competition_score_components" is 'Ordered relational Course of Fire score components for one set. sets_per_round determines repetition.';
comment on column "public"."competition_score_components"."distance_value" is 'Organiser-facing fixed distance value; compared with distance_unit exactly for Concurrent Shooting V1.';
comment on column "public"."competition_score_components"."shots" is 'Physical shots represented by this component within one set.';
comment on table "public"."competition_score_usages" is 'Applies one physical source score to one exact Competition participant/round slot. Future compatible Competitions may reference the same source.';
comment on table "public"."competition_series" is 'Organisation-scoped historical identity, not a template or average policy. Operational configuration stays on each Competition.';
comment on column "public"."competition_series"."discipline_code" is 'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column "public"."competition_series"."discipline_detail" is 'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on table "public"."competition_series_average_defaults" is 'Optional copy-on-create defaults only. They do not make Series editions average-compatible and never rewrite an existing Competition binding.';
comment on table "public"."competition_starting_average_finalisations" is 'One immutable Competition-level marker proving that the complete submitted participant S/Av set was atomically frozen.';
comment on table "public"."competitions" is 'League-season competition configuration. Entries, divisions, scores, and standings are separate future entities.';
comment on column "public"."competitions"."slug" is 'Stable season-scoped route slug generated at creation; renaming a competition does not change it.';
comment on column "public"."competitions"."status" is 'Configuration visibility only: draft or published. The parent league season owns the wider lifecycle.';
comment on column "public"."competitions"."shots_per_round" is 'Backward-compatible total. For structured version 1 it is derived server-side as sets_per_round multiplied by the sum of component shots.';
comment on column "public"."competitions"."entry_fee" is 'Optional GBP entry fee display value only. No payment state or processing is attached.';
comment on column "public"."competitions"."entry_window_mode" is 'Whether the competition inherits the season default entry window or uses custom dates.';
comment on column "public"."competitions"."custom_entry_opens_at" is 'Competition entry-open date when entry_window_mode is custom; nullable for an incomplete draft.';
comment on column "public"."competitions"."custom_entry_closes_at" is 'Competition entry-close date when entry_window_mode is custom; nullable for an incomplete draft.';
comment on column "public"."competitions"."start_date_mode" is 'Whether the competition inherits the season start or uses custom_starts_at.';
comment on column "public"."competitions"."custom_starts_at" is 'Competition start date when start_date_mode is custom; nullable for an incomplete draft.';
comment on column "public"."competitions"."sets_per_round" is 'Number of repetitions of the ordered score-component definition per shooter and round.';
comment on column "public"."competitions"."ranking_method" is 'Base ranking method. X recording is configured independently through uses_x_score.';
comment on column "public"."competitions"."local_scoring_enabled" is 'When true, club and organisation scoring is configured; when false, organisation-only scoring is configured.';
comment on column "public"."competitions"."competition_series_id" is 'NULL means one-off or historical identity not yet established. Never inferred from names.';
comment on column "public"."competitions"."configuration_source_competition_id" is 'Configuration provenance ONLY. Not an average predecessor or permission to reuse source scores.';
comment on column "public"."competitions"."configuration_source_version" is 'Opaque version of the source configuration, including components, rounds and inherited Season dates, at creation.';
comment on column "public"."competitions"."discipline_code" is 'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column "public"."competitions"."discipline_detail" is 'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column "public"."competitions"."shooting_details_version" is 'NULL marks untouched legacy configuration. Version 1 requires explicit structured physical details before publication and Concurrent eligibility.';
comment on table "public"."concurrent_shooting_groups" is 'Organisation- and Season-scoped symmetric groups of compatible contemporaneous Competitions.';
comment on column "public"."concurrent_shooting_groups"."compatibility_signature" is 'Server-derived immutable V1 Course-of-Fire identity while Active or Archived.';
comment on table "public"."concurrent_shooting_round_mappings" is 'Explicit mapping from one physical occurrence to exact member Competition Rounds.';
comment on table "public"."concurrent_shooting_rounds" is 'Group-local physical shooting occurrences. They have no Competition release or Results lifecycle.';
comment on table "public"."league_seasons" is 'Organisation-owned league season containers. Competitions, entries, scores, and standings are separate future entities.';
comment on column "public"."league_seasons"."description" is 'Optional plain-text season description, limited to 2,000 characters.';
comment on column "public"."league_seasons"."slug" is 'Stable organisation-scoped route slug generated when the season is created; renaming a season does not change it.';
comment on column "public"."league_seasons"."status" is 'Manual lifecycle: draft, open, active, completed. Only the next forward status is accepted by the update RPC.';
comment on table "public"."organisation_equipment_types" is 'Reusable Organisation-scoped custom equipment categories with normalized identity.';
comment on table "public"."organisation_information_cards" is 'Owner-authored public long-form information cards for an organisation. Content is constrained Markdown, not HTML.';
comment on column "public"."organisation_information_cards"."position" is 'Dense, one-based public display order. The 1-5 check plus per-organisation uniqueness enforces at most five cards.';
comment on table "public"."organisation_shooting_positions" is 'Reusable Organisation-scoped custom shooting positions/styles with normalized identity.';
comment on table "public"."organisation_staff" is 'Administrative access to an existing organisation. This is separate from personal user_organisations dashboard follows.';
comment on column "public"."organisation_staff"."role" is 'Administrative role. Managers administer the organisation; the single owner additionally controls staff access and ownership.';
comment on column "public"."organisation_staff"."status" is 'Access lifecycle. Only active rows grant organisation-management access.';
comment on table "public"."organisations" is 'Public discovery information for league organisations. Client access is read-only in this phase.';
comment on column "public"."organisations"."about_content" is 'The organisation''s single public long-form About document, stored as constrained Markdown rather than HTML.';
comment on table "public"."profiles" is 'Private application profile data with a one-to-one relationship to auth.users.';
comment on table "public"."shooting_equipment_types" is 'Stable global equipment categories. Physical position and event style do not belong here.';
comment on table "public"."shooting_positions" is 'Stable global physical shooting positions/styles used by score components.';
comment on table "public"."shooting_score_change_events" is 'Append-only canonical source score history for ordinary and Concurrent score changes.';
comment on table "public"."shooting_score_sources" is 'One physical shooting result for one shooter. Competition ownership is represented only by competition_score_usages.';
comment on column "public"."shooting_score_sources"."shooter_profile_id" is 'Stable shooter identity derived from the selected entrant participant; names and club details remain relational.';
comment on column "public"."shooting_score_sources"."concurrent_shooting_round_id" is 'Optional physical occurrence association. Null preserves ordinary independent sources.';
comment on column "public"."shooting_score_sources"."version" is 'Monotonic optimistic-concurrency token; Stage 2 score transactions will compare and increment it.';
comment on table "public"."shooting_score_values" is 'Canonical achieved gun scores for the set/component slots of a physical source result. Missing rows mean no score recorded.';
comment on column "public"."shooting_score_values"."achieved_score" is 'Actual achieved score. Points-dropped entry is converted to maximum_score minus entered points before persistence.';
comment on column "public"."shooting_score_values"."x_count" is 'Optional physical X count. Competition-specific save RPCs decide whether X entry is enabled and validate the round total.';
comment on table "public"."starting_average_score_sources" is 'Minimal calculated Starting Average provenance: the exact canonical physical source scores and values used.';
comment on table "public"."user_organisations" is 'A personal dashboard/navigation association only. It is not organisation membership, office, permission, or league-entry authority.';
comment on column "public"."user_organisations"."user_id" is 'The personal account that added the organisation to its dashboard.';
comment on column "public"."user_organisations"."organisation_id" is 'The league organisation shown in that user dashboard; this grants no role or permission.';
comment on function "private"."concurrent_shooting_compatibility_signature"(p_competition_id bigint) is 'Version 2 exact physical/scoring signature. Ranking, entry format, team size, Round count, Series, and Average Context are deliberately excluded.';
comment on function "private"."get_individual_competition_score_entry_base"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) is 'Returns one authorised participant source-score editor for an Individual, Pairs, or Team Competition Round. Canonical achieved values are converted back to configured entry representation.';
comment on function "private"."protect_published_competition_component"() is 'Blocks Course-of-Fire structure, order, label, maximum, and scoring-method changes while a Competition is published.';
comment on function "private"."protect_published_competition_configuration"() is 'Blocks sporting-column changes while a Competition is published; status-only Return to Draft and administrative/content edits remain available.';
comment on function "private"."require_competition_results_context"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint) is 'Authorises one exact organisation-wide or submitted-club Competition result read scope.';
comment on function "private"."save_individual_competition_round_scores_base"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb) is 'Saves ordinary scores independently and Active Concurrent scores once per physical shooter/Round with atomic usage propagation, optimistic versions, global clear, and immutable audit.';
comment on function "private"."shooter_historical_average_candidates"(p_average_context_id bigint, p_shooter_profile_id uuid, p_before_competition_id bigint) is 'Private canonical achieved-score candidate primitive: published, released, complete, strict-maximum, submitted, contributing, and deduplicated by physical source.';
comment on function "private"."validate_final_competition_schedule"() is 'Deferred Competition schedule validation. Runs as its owner because deferred execution occurs after the public RPC security context has ended.';
comment on function "public"."calculate_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Creates calculated S/Av snapshots or explicit valid no_history snapshots; existing provisional manual overrides remain optional.';
comment on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[]) is 'Creates one private draft competition and its supplied explicit deadlines after exact active-owner authorization.';
comment on function "public"."create_competition"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[]) is 'Creates a private draft using inherited/custom dates and relational Course of Fire configuration.';
comment on function "public"."create_competition_with_average_settings"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint) is 'Creates a one-off Competition and its authoritative Average binding atomically using the existing Competition and Stage 1 Average validators.';
comment on function "public"."create_competition_with_shooting_details"(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb) is 'Creates a private draft with versioned physical shooting details and server-derived shots per Round.';
comment on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date) is 'Creates one draft season after verifying the authenticated caller is the active owner of the active organisation.';
comment on function "public"."create_league_season"(p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_description text) is 'Creates one draft season with an optional plain-text description; preserves the original RPC signature as a compatibility overload.';
comment on function "public"."delete_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Deletes only a participation-free Competition; configuration-only children follow existing cascades.';
comment on function "public"."edit_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns one published division allocation to draft after exact active owner/manager authorization.';
comment on function "public"."finalise_competition_starting_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Explicitly freezes a complete configured participant S/Av set only when no division workflow exists.';
comment on function "public"."get_club_competition_entries"(p_club_id bigint) is 'Returns safe active club competition cards: submitted to active members and submitted or draft to active club management; withdrawn rows remain stored but are omitted.';
comment on function "public"."get_club_competition_entry_management"(p_club_competition_entry_id bigint) is 'Returns the roster and exact competition configuration only to an active owner or official of the entry club.';
comment on function "public"."get_club_operational_summaries"(p_club_id bigint, p_warning_days integer) is 'Returns minimal Club-scoring deadline and participant-completeness summaries only for active Clubs the caller manages. Local cutoff is Shoot-by when present, otherwise Round End.';
comment on function "public"."get_competition_aggregate_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Public released Aggregate standings for an exact active organisation, public season, and published competition. Pair/Team participant breakdowns contain only complete released derived shooting results. UTC deadline dates are inclusive. Competition-rank ties use X when enabled; countback is deferred. No stored totals or source-score writes.';
comment on function "public"."get_competition_best_n_average_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Public released Best N Average standings for an exact active organisation, public season, and published competition. Eligibility requires min(Best N, released Round count) complete results; ineligible entrants remain visible after ranked entrants without a position. Eligible entrants rank by the highest N complete released entrant achieved-score totals; before N returns, every complete released result counts. NSR and unreleased values are excluded. X ranking is not defined. Pair/Team participant breakdowns contain only released derived achieved values. No stored totals or source-score writes.';
comment on function "public"."get_competition_club_entry_context"(p_competition_id bigint) is 'Returns safe competition entry context for the caller active clubs without exposing another club roster.';
comment on function "public"."get_competition_concurrent_shooting_summary"(p_organisation_id bigint, p_competition_id bigint) is 'Returns the Organisation-management Concurrent Shooting indicator for one Competition, or null when independent.';
comment on function "public"."get_competition_division_average_projection"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns staff-only participant S/Av values and ephemeral entrant means; resolved nulls are valid and never averaged as zero.';
comment on function "public"."get_competition_division_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns submitted entrant-unit names, clubs, and draft/published division layout only to an active owner or manager of the exact organisation.';
comment on function "public"."get_competition_gun_score_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Public released Gun Score standings for an exact active organisation, public season, and published competition. Complete released gun results are accumulated directly: points scored rank descending and points dropped rank ascending, with higher X as the only enabled tie-break. NSR contributes no gun result or X. Pair/Team participant breakdowns contain only released derived results. UTC Round End dates are inclusive. No stored totals or source-score writes.';
comment on function "public"."get_competition_lifecycle_state"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns owner-only lifecycle availability after checking the exact Organisation, Season, and Competition relationship.';
comment on function "public"."get_competition_result_averages"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Released Results participant statistics for Aggregate, Best-N Average, Gun Score, and Round Robin. R/Av is the unrounded numeric mean of complete released canonical achieved scores in this Competition, with null for no qualifying score. Frozen S/Av is public for Individual Results and staff-only for Pair/Team participant breakdowns; no entrant-level Pair/Team average is created. No ranking or score state is written.';
comment on function "public"."get_competition_round_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint) is 'Returns live normalised participant and entrant Round results derived from canonical source scores. Missing required slots make totals incomplete; no aggregate totals, zero, or NSR are stored or manufactured.';
comment on function "public"."get_competition_round_robin_results"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Published Round Robin schedule and released Results. W=2, D=1, L=0; complete bye=2. NSR matches unresolved, incomplete bye no points. Match points then gun aggregate then X; no countback. Future gun values, outcomes and points are gated at inclusive UTC Round End.';
comment on function "public"."get_competition_series_sources"(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_target_starts_at date) is 'Returns authenticated configuration-source candidates outside the target Season, with an unambiguous chronological recommendation when available.';
comment on function "public"."get_competition_shooting_display"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns only safe human-facing equipment and component physical details for public Competitions or contextual Organisation staff.';
comment on function "public"."get_competition_starting_average_management"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns the minimum staff-only participant and provisional Starting Average projection required by Stage 2A management UI.';
comment on function "public"."get_concurrent_shooting_competition_candidates"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) is 'Returns physical Concurrent eligibility; legacy Competitions without complete structured details are explicitly ineligible.';
comment on function "public"."get_concurrent_shooting_group_lifecycle"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) is 'Returns server-derived activation and cancellation readiness for an authorised Concurrent Shooting group.';
comment on function "public"."get_individual_competition_score_entry"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint) is 'Authorised participant score entry with Active Concurrent sharing and explicit read-only Archived Concurrent metadata.';
comment on function "public"."get_my_organisations"() is 'Deduplicates manual follows, active staff access, and submitted competition participation through active club membership.';
comment on function "public"."get_my_shooter_analytics"(p_season_id bigint, p_equipment_kind text, p_equipment_code text, p_equipment_custom_id bigint, p_position_mode text, p_position_code text, p_position_custom_id bigint, p_distance_mode text, p_distance_value numeric, p_distance_unit text, p_history_page integer, p_include_if_seeded_today boolean) is 'Current-shooter workspace over complete canonical achieved scores with released-only Competition usages. Physical history, trends, discipline and Season comparisons deduplicate by shooting_score_source. Optional Division inputs expose only published Individual rosters with frozen S/Av values for a server-side, non-mutating what-if using the canonical seeding algorithm.';
comment on function "public"."get_my_shooting_competitions"() is 'Current-shooter Competition participation from submitted entrant slots across Clubs. Returns published Competition, public Season, schedule and published Division metadata only; official released Results and participant averages remain in their existing RPCs.';
comment on function "public"."get_public_club_results_catalog"(p_club_slug text, p_query text, p_offset integer, p_limit integer) is 'Public active-club discovery and exact club projection. Competition participation is derived only from submitted entries in published competitions under public seasons and active organisations. Omits membership, profile, contact, entry-management, draft, withdrawn, score-source, and unreleased score fields.';
comment on function "public"."get_public_results_catalog"(p_organisation_slug text, p_season_slug text, p_competition_slug text, p_query text, p_offset integer, p_limit integer) is 'Public discovery projection for active organisations, public seasons, published competitions, public competition configuration, and published division allocations. Omits contact, staff, membership, profile identifiers, entry-management state, draft data, and every score source field.';
comment on function "public"."get_published_competition_divisions"(p_competition_id bigint) is 'Returns the complete published competition allocation to authenticated viewers of a visible published competition, exposing entrant names and clubs but no contact data.';
comment on function "public"."map_matching_concurrent_shooting_round_numbers"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint) is 'Idempotently persists exact common Round-number mappings for a Draft while preserving every conflicting manual mapping.';
comment on function "public"."publish_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Publishes a stored draft through the same authoritative Competition configuration validator used by update_competition.';
comment on function "public"."publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Publishes a complete division allocation and, when configured, atomically validates and freezes its reviewed participant Starting Averages.';
comment on function "public"."register_club"(p_name text, p_town text, p_county text, p_postcode text, p_website text) is 'Atomically registers an active club and makes the authenticated caller its active owner.';
comment on function "public"."register_organisation"(p_name text, p_short_name text, p_organisation_type text, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) is 'Atomically registers an active organisation and makes the authenticated caller its active owner.';
comment on function "public"."rename_competition_series"(p_organisation_id bigint, p_competition_series_id bigint, p_name text) is 'Renames a Competition Series after exact active Organisation owner authorisation. Its immutable slug and sporting identity are unchanged.';
comment on function "public"."return_competition_to_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint) is 'Returns a published Competition to private draft only when no entry, entrant, participant, or division data exists.';
comment on function "public"."save_and_publish_competition_divisions"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) is 'Atomically saves and publishes one complete division allocation; failed publication validation rolls back the supplied draft.';
comment on function "public"."save_and_publish_competition_divisions_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) is 'Atomically saves a reviewed division layout, freezes configured Starting Averages, and publishes; all validation failures roll back.';
comment on function "public"."save_and_submit_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) is 'Atomically saves the backward-compatible entrant payload and submits it without changing participant-level score ownership.';
comment on function "public"."save_club_competition_entry"(p_club_competition_entry_id bigint, p_entrants jsonb) is 'Atomically replaces draft entrant composition. Legacy participant arrays remain supported; linked Pair/Team objects carry only a persistent unit ID and the database copies its current roster and name snapshot.';
comment on function "public"."save_competition_division_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb) is 'Atomically replaces one editable division draft after exact active owner/manager and entrant relationship validation.';
comment on function "public"."save_competition_division_draft_with_average_review"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text) is 'Saves a division draft and records the exact currently reviewed participant S/Av fingerprint atomically.';
comment on function "public"."save_individual_competition_round_scores"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb) is 'Authorised score save; Archived Concurrent mapped Rounds are read-only and Active shared writes retain the Stage 2 transaction contract.';
comment on function "public"."search_club_competition_entry_members"(p_club_competition_entry_id bigint, p_query text, p_limit integer) is 'Searches safe profile-name fields for active members of the exact managed club, capped at 50 results.';
comment on function "public"."set_concurrent_shooting_round_mapping"(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint) is 'Atomically sets or removes one member Competition mapping for one Draft physical Concurrent Round.';
comment on function "public"."set_manual_competition_starting_average"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_entrant_participant_id bigint, p_starting_average numeric, p_manual_reason text) is 'Sets an optional manual S/Av. NULL preserves the explicit no-history state and never becomes zero.';
comment on function "public"."start_club_competition_entry"(p_competition_id bigint, p_club_id bigint) is 'Starts or resumes the unique club submission after exact club-role and authoritative entry-window checks.';
comment on function "public"."submit_club_competition_entry"(p_club_competition_entry_id bigint) is 'Validates and submits exact local entrant slots, refreshing linked Pair/Team name snapshots immediately before a Draft becomes historical.';
comment on function "public"."update_club_about"(p_club_id bigint, p_about_content text) is 'Updates only the single About document for an active club after verifying its active owner.';
comment on function "public"."update_club_details"(p_club_id bigint, p_name text, p_town text, p_county text, p_postcode text, p_website text) is 'Updates normal details for active officials or owners, while restricting official club-name changes to the active owner.';
comment on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[], p_status text) is 'Atomically updates competition configuration and explicit deadlines; draft-to-published requires complete valid data.';
comment on function "public"."update_competition"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[], p_status text) is 'Updates Competition configuration in place, preserving stable Competition and unchanged Round IDs.';
comment on function "public"."update_competition_shooting_details_draft"(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb) is 'Updates a draft through the versioned physical configuration path; published configuration remains locked.';
comment on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text) is 'Updates mutable season fields after verifying the active owner of the season organisation; the route slug remains stable.';
comment on function "public"."update_league_season"(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text, p_description text) is 'Updates mutable season fields including an optional plain-text description; preserves the original RPC signature as a compatibility overload.';
comment on function "public"."update_organisation_about"(p_organisation_id bigint, p_about_content text) is 'Updates only the single About document for an active organisation after verifying its active owner.';
comment on function "public"."update_organisation_contact_details"(p_organisation_id bigint, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text) is 'Updates only structured contact fields for an active organisation after verifying its active owner.';
comment on function "public"."withdraw_club_competition_entry"(p_club_competition_entry_id bigint) is 'Withdraws the exact club submission before entry close while preserving its durable row and entrant composition.';

commit;

