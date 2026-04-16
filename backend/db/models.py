from datetime import datetime

from sqlalchemy import (
    BigInteger,
    JSON,
    Boolean,
    Column,
    DECIMAL,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Server(Base):
    __tablename__ = "servers"

    server_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    status = Column(Boolean, default=True, nullable=False)
    type = Column(String(50))
    discord_url = Column(Text)
    forum_url = Column(Text)
    website_url = Column(Text)
    description = Column(Text, nullable=True)
    dashboard_views = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, nullable=False)
    last_data_update = Column(DateTime, nullable=True, index=True)
    allowed_windows = Column(JSON, nullable=False, default=lambda: [14])

    simple_items = relationship(
        "SimpleItemDictionary", back_populates="server", cascade="all, delete-orphan"
    )
    bonus_items = relationship(
        "BonusItemDictionary", back_populates="server", cascade="all, delete-orphan"
    )
    daily_stats = relationship(
        "DailyServerStats", back_populates="server", cascade="all, delete-orphan"
    )
    currencies = relationship(
        "ServerCurrency",
        back_populates="server",
        cascade="all, delete-orphan",
        order_by="desc(ServerCurrency.threshold)",
    )


class ServerCurrency(Base):
    __tablename__ = "server_currencies"

    currency_id = Column(Integer, primary_key=True, autoincrement=True)
    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)
    symbol = Column(String(10), nullable=False)
    threshold = Column(DECIMAL(50, 0), nullable=False)

    server = relationship("Server", back_populates="currencies")
    __table_args__ = (UniqueConstraint("server_id", "symbol", name="uq_server_currency_symbol"),)


class SimpleItemDictionary(Base):
    __tablename__ = "simple_items_dictionary"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    vid = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    search_count = Column(Integer, default=0, nullable=False)

    server = relationship("Server", back_populates="simple_items")
    daily_stats = relationship(
        "DailySimpleItemStats", back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("idx_simple_items_name", "name"),)


class BonusItemDictionary(Base):
    __tablename__ = "bonus_items_dictionary"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    vid = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    search_count = Column(Integer, default=0, nullable=False)

    server = relationship("Server", back_populates="bonus_items")
    combinations = relationship(
        "UniqueBonusCombination", back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("idx_bonus_items_name", "name"),)


class BonusTypesDictionary(Base):
    __tablename__ = "bonus_types_dictionary"

    bonus_id = Column(Integer, primary_key=True, autoincrement=True)
    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)

    combination_values = relationship("UniqueCombinationValues", back_populates="bonus_type")

    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_bonus_types_server_name"),
        Index("idx_bonus_types_server_name", "server_id", "name"),
    )


class DailyServerStats(Base):
    __tablename__ = "daily_server_stats"

    stat_id = Column(BigInteger, primary_key=True, autoincrement=True)
    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), nullable=False)
    date = Column(DateTime, nullable=False)
    total_simple_items_amount = Column(BigInteger)
    unique_simple_items_amount = Column(Integer)
    total_bonus_items_amount = Column(Integer)
    unique_bonus_items_amount = Column(Integer)

    server = relationship("Server", back_populates="daily_stats")

    __table_args__ = (
        UniqueConstraint("server_id", "date", name="uq_daily_server_stats_server_date"),
        Index("idx_daily_server_stats_server_date", "server_id", "date"),
    )


class DailySimpleItemStats(Base):
    __tablename__ = "daily_simple_item_stats"

    stat_id = Column(BigInteger, primary_key=True, autoincrement=True)
    server_id = Column(Integer, nullable=False)
    item_vid = Column(Integer, nullable=False)
    date = Column(DateTime, nullable=False)
    price_q10 = Column(DECIMAL(50, 0))
    price_median = Column(DECIMAL(50, 0))
    item_amount = Column(BigInteger)
    shop_appearance_count = Column(Integer)

    item = relationship("SimpleItemDictionary", back_populates="daily_stats")

    __table_args__ = (
        ForeignKeyConstraint(
            ["server_id", "item_vid"],
            ["simple_items_dictionary.server_id", "simple_items_dictionary.vid"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("server_id", "item_vid", "date", name="uq_daily_simple_stats_server_item_date"),
        Index("idx_daily_simple_item_stats_server_vid_date", "server_id", "item_vid", "date"),
    )


class UniqueBonusCombination(Base):
    __tablename__ = "unique_bonus_combinations"

    combination_id = Column(BigInteger, primary_key=True, autoincrement=True)
    server_id = Column(Integer, nullable=False)
    item_vid = Column(Integer, nullable=False)
    bonuses_hash = Column(String(64), nullable=False)

    item = relationship("BonusItemDictionary", back_populates="combinations")
    values = relationship(
        "UniqueCombinationValues", back_populates="combination", cascade="all, delete-orphan"
    )
    sightings = relationship(
        "BonusItemSighting", back_populates="combination", cascade="all, delete-orphan"
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["server_id", "item_vid"],
            ["bonus_items_dictionary.server_id", "bonus_items_dictionary.vid"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("server_id", "item_vid", "bonuses_hash", name="uq_bonus_combination_hash"),
        Index("idx_ubc_server_item", "server_id", "item_vid"),
    )


class UniqueCombinationValues(Base):
    __tablename__ = "unique_combination_values"

    combination_id = Column(
        BigInteger,
        ForeignKey("unique_bonus_combinations.combination_id", ondelete="CASCADE"),
        primary_key=True,
    )
    bonus_id = Column(
        Integer,
        ForeignKey("bonus_types_dictionary.bonus_id", ondelete="RESTRICT"),
        primary_key=True,
    )
    bonus_index = Column(Integer, primary_key=True, default=0, nullable=False)
    value = Column(Integer, nullable=False)

    combination = relationship("UniqueBonusCombination", back_populates="values")
    bonus_type = relationship("BonusTypesDictionary", back_populates="combination_values")

    __table_args__ = (
        Index("idx_unique_combination_values_bonus_id_value", "bonus_id", "value"),
        Index("idx_ucv_combination", "combination_id"),
    )


class BonusItemSighting(Base):
    __tablename__ = "bonus_item_sightings"

    sighting_id = Column(BigInteger, primary_key=True, autoincrement=True)
    combination_id = Column(
        BigInteger,
        ForeignKey("unique_bonus_combinations.combination_id", ondelete="CASCADE"),
        nullable=False,
    )
    price = Column(DECIMAL(50, 0), nullable=False)
    item_count = Column(Integer, default=1, nullable=False)
    first_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    combination = relationship("UniqueBonusCombination", back_populates="sightings")

    __table_args__ = (
        UniqueConstraint("combination_id", "price", name="uq_bonus_sighting_combination_price"),
        Index("idx_bonus_sightings_last_seen", "last_seen_at"),
        Index("idx_bis_combination", "combination_id"),
        Index("idx_bonus_sightings_first_seen", "first_seen_at"),
    )


class Shop(Base):
    __tablename__ = "shops"

    shop_id = Column(BigInteger, primary_key=True, autoincrement=True)
    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    first_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    sightings_count = Column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_shops_server_name"),
        Index("idx_shops_server_name", "server_id", "name"),
    )


class ShopDailyPresence(Base):
    __tablename__ = "shop_daily_presence"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    shop_id = Column(BigInteger, ForeignKey("shops.shop_id", ondelete="CASCADE"), primary_key=True)
    date = Column(DateTime, primary_key=True)

    __table_args__ = (
        Index("idx_sdp_server_date", "server_id", "date"),
        Index("idx_sdp_server_shop_date", "server_id", "shop_id", "date"),
    )


class ShopDailyStats(Base):
    __tablename__ = "shop_daily_stats"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    date = Column(DateTime, primary_key=True)

    new_shops = Column(Integer, nullable=False)
    disappeared_shops = Column(Integer, nullable=False)
    continuing_shops = Column(Integer, nullable=False)
    total_shops_count = Column(Integer)
    median_unique_items_per_shop = Column(Numeric(20, 2))
    computed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_shop_daily_stats_server_date", "server_id", "date"),)


class ShopDailyWindowStats(Base):
    __tablename__ = "shop_daily_window_stats"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    date = Column(DateTime, primary_key=True)
    window_days = Column(Integer, primary_key=True)

    unique_shops = Column(Integer)
    avg_presence_streak_days = Column(Numeric(20, 2))
    total_shops_count_avg = Column(Numeric(20, 2))
    total_shops_count_min = Column(Integer)
    total_shops_count_max = Column(Integer)
    median_unique_items_per_shop_avg = Column(Numeric(20, 2))
    median_unique_items_per_shop_min = Column(Numeric(20, 2))
    median_unique_items_per_shop_max = Column(Numeric(20, 2))
    computed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_sdws_server_date", "server_id", "date"),
        Index("idx_sdws_server_window_date", "server_id", "window_days", "date"),
    )


class SimpleItem24hTop10(Base):
    __tablename__ = "simple_item_24h_top10"

    server_id = Column(Integer, ForeignKey("servers.server_id", ondelete="CASCADE"), primary_key=True)
    as_of_date = Column(DateTime, primary_key=True)
    metric_type = Column(String(50), primary_key=True)
    rank = Column(Integer, primary_key=True)
    item_vid = Column(Integer, nullable=False)

    price_now = Column(DECIMAL(50, 0))
    price_prev = Column(DECIMAL(50, 0))
    change_abs = Column(DECIMAL(50, 0))
    change_pct = Column(DECIMAL(9, 4))

    amount_now = Column(Integer)
    amount_prev = Column(Integer)

    shops_now = Column(Integer)
    shops_prev = Column(Integer)

    computed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["server_id", "item_vid"],
            ["simple_items_dictionary.server_id", "simple_items_dictionary.vid"],
            ondelete="CASCADE",
        ),
        Index("idx_simple_item_24h_top10_lookup", "server_id", "as_of_date", "metric_type"),
    )


class ServerVotes(Base):
    __tablename__ = "server_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    total_votes = Column(Integer, default=0, nullable=False)
    last_vote_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_server_votes_name", "name"),)


class SiteUpdate(Base):
    __tablename__ = "site_updates"

    entry_id = Column(BigInteger, primary_key=True, autoincrement=True)
    type = Column(String(20), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    published = Column(Boolean, default=True, nullable=False)

    __table_args__ = (
        Index("idx_site_updates_created_at", "created_at"),
        Index("idx_site_updates_type_created_at", "type", "created_at"),
    )


__all__ = [
    "Base",
    "Server",
    "ServerCurrency",
    "SimpleItemDictionary",
    "BonusItemDictionary",
    "BonusTypesDictionary",
    "DailyServerStats",
    "DailySimpleItemStats",
    "UniqueBonusCombination",
    "UniqueCombinationValues",
    "BonusItemSighting",
    "Shop",
    "ShopDailyPresence",
    "ShopDailyStats",
    "ShopDailyWindowStats",
    "SimpleItem24hTop10",
    "ServerVotes",
    "SiteUpdate",
]
