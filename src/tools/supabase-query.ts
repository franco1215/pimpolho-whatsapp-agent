import { createTool } from "@voltagent/core";
import { z } from "zod";
import { supabase } from "../../lib/supabase";

export const supabaseQueryTool = createTool({
  name: "supabaseQuery",
  description:
    "Executa consultas no banco de dados Supabase do Pimpolho Foods. Pode listar tabelas, consultar dados com filtros, inserir ou atualizar registros.",
  parameters: z.object({
    action: z
      .enum(["select", "insert", "update", "delete", "list_tables"])
      .describe("Tipo de operação no banco"),
    table: z.string().optional().describe("Nome da tabela (ex: products, orders, categories)"),
    columns: z.string().optional().default("*").describe("Colunas para SELECT (ex: 'id,name,price')"),
    filters: z
      .array(
        z.object({
          column: z.string(),
          operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike"]),
          value: z.string(),
        }),
      )
      .optional()
      .describe("Filtros para a query"),
    data: z
      .record(z.unknown())
      .optional()
      .describe("Dados para INSERT ou UPDATE"),
    limit: z.number().optional().default(50).describe("Limite de resultados"),
    orderBy: z.string().optional().describe("Coluna para ordenar"),
    ascending: z.boolean().optional().default(true).describe("Ordem ascendente?"),
  }),
  execute: async ({ action, table, columns, filters, data, limit, orderBy, ascending }) => {
    try {
      if (action === "list_tables") {
        const { data: tables, error } = await supabase.rpc("get_table_names").select("*");
        if (error) {
          // Fallback: query information_schema
          const { data: fallback, error: fallbackError } = await supabase
            .from("information_schema.tables" as string)
            .select("table_name")
            .eq("table_schema", "public");

          if (fallbackError) {
            return {
              success: false,
              message: "Não foi possível listar tabelas. Tente consultar uma tabela específica.",
            };
          }
          return { success: true, tables: fallback };
        }
        return { success: true, tables };
      }

      if (!table) {
        return { success: false, message: "Nome da tabela é obrigatório para esta operação." };
      }

      if (action === "select") {
        let query = supabase.from(table).select(columns || "*");

        if (filters) {
          for (const f of filters) {
            query = query.filter(f.column, f.operator, f.value);
          }
        }

        if (orderBy) {
          query = query.order(orderBy, { ascending });
        }

        query = query.limit(limit || 50);

        const { data: result, error } = await query;
        if (error) throw new Error(error.message);

        return {
          success: true,
          data: result,
          count: result?.length || 0,
          message: `${result?.length || 0} registros encontrados na tabela ${table}`,
        };
      }

      if (action === "insert" && data) {
        const { data: result, error } = await supabase.from(table).insert(data).select();
        if (error) throw new Error(error.message);
        return { success: true, data: result, message: `Registro inserido na tabela ${table}` };
      }

      if (action === "update" && data && filters) {
        let query = supabase.from(table).update(data);
        for (const f of filters) {
          query = query.filter(f.column, f.operator, f.value);
        }
        const { data: result, error } = await query.select();
        if (error) throw new Error(error.message);
        return { success: true, data: result, message: `Registros atualizados na tabela ${table}` };
      }

      if (action === "delete" && filters) {
        let query = supabase.from(table).delete();
        for (const f of filters) {
          query = query.filter(f.column, f.operator, f.value);
        }
        const { data: result, error } = await query.select();
        if (error) throw new Error(error.message);
        return { success: true, data: result, message: `Registros deletados da tabela ${table}` };
      }

      return { success: false, message: "Parâmetros insuficientes para a operação." };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        message: "Erro ao executar consulta no banco de dados.",
      };
    }
  },
});
