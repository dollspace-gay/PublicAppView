import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface TableField {
  name: string;
  type: string;
  description: string;
}

interface TableSchema {
  name: string;
  description: string;
  rows: string;
  color: string;
  fields: TableField[];
  indexes: string[];
}

export function DatabaseSchema() {
  const {
    data: tables,
    isLoading,
    error,
    isError,
  } = useQuery<TableSchema[]>({
    queryKey: ['/api/database/schema'],
  });

  console.log('[DatabaseSchema] Query state:', {
    isLoading,
    isError,
    hasData: !!tables,
    tablesLength: tables?.length,
    error,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-border">
            <CardHeader className="bg-muted/5 border-b border-border">
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="p-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              No database tables found
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {tables.map((table) => (
        <Card
          key={table.name}
          className="border-border"
          data-testid={`table-${table.name}`}
        >
          <CardHeader className={`bg-${table.color}/5 border-b border-border`}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-mono">
                  {table.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {table.description}
                </p>
              </div>
              <span
                className={`px-3 py-1 bg-${table.color}/10 text-${table.color} text-xs font-semibold rounded-full font-mono`}
                data-testid={`text-rows-${table.name}`}
              >
                {table.rows} rows
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-3">
              {table.fields.map((field) => (
                <div
                  key={field.name}
                  className="flex items-start justify-between p-3 bg-muted rounded"
                  data-testid={`field-${table.name}-${field.name}`}
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground font-mono">
                      {field.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {field.description}
                    </p>
                  </div>
                  <span className="text-xs text-accent font-mono">
                    {field.type}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-muted/50 rounded border border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Indexes
              </p>
              <div className="space-y-1">
                {table.indexes.map((index) => (
                  <p
                    key={index}
                    className="text-xs font-mono text-foreground"
                    data-testid={`index-${table.name}-${index}`}
                  >
                    • {index}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
