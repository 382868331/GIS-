--
-- PostgreSQL database dump
--

\restrict zPyKnSR3TdXsdtRsTOhvBoMSscDEcgoR7Z4R6RjEaVgcWQwLs3qa6YeN4B4Q9eS

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    event_type character varying(64) NOT NULL,
    title character varying(120) NOT NULL,
    message text NOT NULL,
    resource_type character varying(40),
    resource_id character varying(36),
    payload json NOT NULL,
    is_read boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: point_cloud_edit_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.point_cloud_edit_documents (
    point_cloud_id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    revision integer NOT NULL,
    document json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: point_cloud_upload_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.point_cloud_upload_sessions (
    id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    original_name character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    expected_sha256 character varying(64),
    chunk_size integer NOT NULL,
    total_chunks integer NOT NULL,
    uploaded_chunks json NOT NULL,
    status character varying(24) NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: point_clouds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.point_clouds (
    id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    original_name character varying(255) NOT NULL,
    storage_key character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 character varying(64) NOT NULL,
    las_version character varying(16) NOT NULL,
    point_format integer NOT NULL,
    point_count bigint NOT NULL,
    has_rgb boolean NOT NULL,
    has_intensity boolean NOT NULL,
    min_x double precision NOT NULL,
    max_x double precision NOT NULL,
    min_y double precision NOT NULL,
    max_y double precision NOT NULL,
    min_z double precision NOT NULL,
    max_z double precision NOT NULL,
    scale_x double precision NOT NULL,
    scale_y double precision NOT NULL,
    scale_z double precision NOT NULL,
    offset_x double precision NOT NULL,
    offset_y double precision NOT NULL,
    offset_z double precision NOT NULL,
    status character varying(24) NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    crs_wkt text,
    crs_epsg integer,
    classification_stats json,
    return_stats json,
    gps_time_min double precision,
    gps_time_max double precision,
    generating_software character varying(64),
    system_identifier character varying(64),
    vlr_summary json,
    evlr_summary json
);


--
-- Name: test; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test (
    id bigint NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: test_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_id_seq OWNED BY public.test.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(320) NOT NULL,
    hashed_password character varying(1024) NOT NULL,
    is_active boolean NOT NULL,
    is_superuser boolean NOT NULL,
    is_verified boolean NOT NULL
);


--
-- Name: test id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test ALTER COLUMN id SET DEFAULT nextval('public.test_id_seq'::regclass);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: point_cloud_edit_documents point_cloud_edit_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_cloud_edit_documents
    ADD CONSTRAINT point_cloud_edit_documents_pkey PRIMARY KEY (point_cloud_id);


--
-- Name: point_cloud_upload_sessions point_cloud_upload_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_cloud_upload_sessions
    ADD CONSTRAINT point_cloud_upload_sessions_pkey PRIMARY KEY (id);


--
-- Name: point_clouds point_clouds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_clouds
    ADD CONSTRAINT point_clouds_pkey PRIMARY KEY (id);


--
-- Name: point_clouds point_clouds_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_clouds
    ADD CONSTRAINT point_clouds_storage_key_key UNIQUE (storage_key);


--
-- Name: test test_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test
    ADD CONSTRAINT test_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_notifications_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_event_type ON public.notifications USING btree (event_type);


--
-- Name: ix_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: ix_notifications_resource_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_resource_id ON public.notifications USING btree (resource_id);


--
-- Name: ix_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: ix_point_cloud_edit_documents_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_point_cloud_edit_documents_user_id ON public.point_cloud_edit_documents USING btree (user_id);


--
-- Name: ix_point_cloud_upload_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_point_cloud_upload_sessions_user_id ON public.point_cloud_upload_sessions USING btree (user_id);


--
-- Name: ix_point_clouds_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_point_clouds_sha256 ON public.point_clouds USING btree (sha256);


--
-- Name: ix_point_clouds_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_point_clouds_user_id ON public.point_clouds USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- PostgreSQL database dump complete
--

\unrestrict zPyKnSR3TdXsdtRsTOhvBoMSscDEcgoR7Z4R6RjEaVgcWQwLs3qa6YeN4B4Q9eS

