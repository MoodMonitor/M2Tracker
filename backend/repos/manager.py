from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .base import BaseRepository, timed_operation
from .servers import ServerRepository
from .stats import StatsRepository
from .simple_items import SimpleItemsRepository
from .bonus_items import BonusItemsRepository
from .feedback import FeedbackRepository
from .bug_reports import BugReportRepository
from ..db.models import SiteUpdate


class RepositoryManager(BaseRepository):
    def __init__(self, db: Session):
        super().__init__(db)
        self.servers = ServerRepository(db)
        self.stats = StatsRepository(db)
        self.simple_items = SimpleItemsRepository(db)
        self.bonus_items = BonusItemsRepository(db)
        self.feedback = FeedbackRepository(db)
        self.bug_reports = BugReportRepository(db)

    @timed_operation
    def get_latest_updates(
        self, limit: int = 10, types: Optional[List[str]] = None
    ) -> List[SiteUpdate]:
        stmt = select(SiteUpdate).where(SiteUpdate.published == True)
        if types:
            stmt = stmt.where(SiteUpdate.type.in_(types))
        stmt = stmt.order_by(SiteUpdate.created_at.desc()).limit(
            self._sanitize_limit(limit)
        )
        return self.db.execute(stmt).scalars().all()
