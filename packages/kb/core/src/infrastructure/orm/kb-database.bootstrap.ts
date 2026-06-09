import {
  DATABASE_SERVICE_TOKEN,
  Inject,
  Injectable,
  type DatabaseService,
  type OnModuleInit,
} from '@dangao/bun-server';
import { KB_MYSQL_SCHEMA } from './kb-mysql-schema';

function splitSqlStatements(schema: string): string[] {
  return schema
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

@Injectable()
export class KbDatabaseBootstrap implements OnModuleInit {
  public constructor(
    @Inject(DATABASE_SERVICE_TOKEN) private readonly databaseService: DatabaseService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.databaseService.initialize();
    for (const sql of splitSqlStatements(KB_MYSQL_SCHEMA)) {
      await this.databaseService.query(sql);
    }
  }
}
