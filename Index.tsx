import { useState, useMemo, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { DateFilters } from '@/components/dashboard/DateFilters';
import { SummaryPanel } from '@/components/dashboard/SummaryPanel';
import { TabNavigation } from '@/components/dashboard/TabNavigation';
import { FinancialTable } from '@/components/dashboard/FinancialTable';
import { FinancialChart } from '@/components/dashboard/FinancialChart';
import { useOperationalData, useExcludedData } from '@/hooks/useFinancialData';
import {
  filterByDateRange,
  calculateSummary,
  parseBrDate,
  formatCurrency,
  getProlaboreRecords,
  sumProlaboreForPeriod,
} from '@/utils/dataProcessing';
import type { TabType, FinancialRecord } from '@/types/financial';

const Index = () => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeProlabore, setIncludeProlabore] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('cc1000');
  const [ccFilter, setCCFilter] = useState('all');

  const { data: operationalData, isLoading: isLoadingOperational } = useOperationalData();
  const { data: excludedData, isLoading: isLoadingExcluded } = useExcludedData();

  // Set initial date range based on data
  useEffect(() => {
    if (operationalData && excludedData && !startDate && !endDate) {
      const allDates = [
        ...operationalData.map((d) => parseBrDate(d.data)),
        ...excludedData.map((d) => parseBrDate(d.data)),
      ].filter((d): d is Date => d !== null && !isNaN(d.getTime()));

      if (allDates.length > 0) {
        const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
        setStartDate(minDate.toISOString().split('T')[0]);
        setEndDate(maxDate.toISOString().split('T')[0]);
      }
    }
  }, [operationalData, excludedData, startDate, endDate]);

  const filteredOperationalData = useMemo(() => {
    if (!operationalData || !excludedData) return [];
    let filtered = filterByDateRange(operationalData, startDate, endDate);

    if (includeProlabore) {
      // Buscar pró-labores reais da planilha de excluídos, filtrados por data
      const filteredExcluded = filterByDateRange(excludedData, startDate, endDate);
      const prolaboreRecords = getProlaboreRecords(filteredExcluded, '1000');
      
      // Calcular soma total dos pró-labores no período
      const totalProlabore = sumProlaboreForPeriod(filteredExcluded, '1000');
      
      // Adicionar como registro único agregado
      if (totalProlabore > 0) {
        filtered.push({
          centroCusto: '1000',
          data: endDate || new Date().toISOString().split('T')[0],
          planoFinanceiro: 'Soma Pró-Labore (Diretoria)',
          valor: totalProlabore,
          credor: '',
        });
      }
    }

    return filtered;
  }, [operationalData, excludedData, startDate, endDate, includeProlabore]);

  const filteredExcludedData = useMemo(() => {
    if (!excludedData) return [];
    return filterByDateRange(excludedData, startDate, endDate);
  }, [excludedData, startDate, endDate]);

  const operationalSummary = useMemo(
    () => calculateSummary(filteredOperationalData),
    [filteredOperationalData]
  );

  const excludedSummary = useMemo(
    () => calculateSummary(filteredExcludedData),
    [filteredExcludedData]
  );

  const periodText = useMemo(() => {
    if (!startDate || !endDate) return 'Todo o Período';
    const format = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-');
      return `${day}/${month}/${year}`;
    };
    return `${format(startDate)} a ${format(endDate)}`;
  }, [startDate, endDate]);

  if (isLoadingOperational || isLoadingExcluded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-xl text-muted-foreground">Carregando dados...</p>
        </div>
      </div>
    );
  }

  const isExcludedTab = activeTab === 'excluded' || activeTab === 'excluded-chart';

  const renderTabContent = () => {
    switch (activeTab) {
      case 'cc1000':
      case 'cc2000':
      case 'cc2002': {
        const cc = activeTab.replace('cc', '');
        const ccData = filteredOperationalData.filter((d) => d.centroCusto === cc);
        const grouped = new Map<string, number>();
        ccData.forEach((record) => {
          grouped.set(
            record.planoFinanceiro,
            (grouped.get(record.planoFinanceiro) || 0) + record.valor
          );
        });
        const tableData = Array.from(grouped.entries())
          .map(([plano, valor]) => ({
            plano,
            valor,
            highlight: plano.toLowerCase().includes('soma pró-labore'),
          }))
          .sort((a, b) => b.valor - a.valor);

        return (
          <FinancialTable
            data={tableData}
            columns={[
              { header: 'Plano Financeiro', accessor: 'plano' },
              {
                header: `Valor (${periodText})`,
                accessor: 'valor',
                format: formatCurrency,
              },
            ]}
          />
        );
      }

      case 'total': {
        // Agrupar por plano financeiro (somando todos os CCs)
        const grouped = new Map<string, number>();
        
        filteredOperationalData.forEach((record) => {
          const currentValue = grouped.get(record.planoFinanceiro) || 0;
          grouped.set(record.planoFinanceiro, currentValue + record.valor);
        });

        const tableData = Array.from(grouped.entries())
          .map(([plano, valor]) => ({
            plano,
            valor,
            highlight: plano.toLowerCase().includes('soma pró-labore'),
          }))
          .sort((a, b) => b.valor - a.valor);

        return (
          <FinancialTable
            data={tableData}
            columns={[
              { header: 'Plano Financeiro', accessor: 'plano' },
              {
                header: `Valor (${periodText})`,
                accessor: 'valor',
                format: formatCurrency,
              },
            ]}
          />
        );
      }

      case 'chart': {
        const chartDataAll = filteredOperationalData;
        const chartData =
          ccFilter === 'all'
            ? chartDataAll
            : chartDataAll.filter((d) => d.centroCusto === ccFilter);

        const grouped = new Map<string, number>();
        chartData.forEach((record) => {
          grouped.set(
            record.planoFinanceiro,
            (grouped.get(record.planoFinanceiro) || 0) + record.valor
          );
        });

        const chartValues = Array.from(grouped.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value);

        const ccLabel = ccFilter === 'all' ? 'Soma de Todos' : `CC ${ccFilter}`;

        return (
          <FinancialChart
            data={chartValues}
            title={`Despesas por Plano Financeiro (${ccLabel}) - ${periodText}`}
            ccFilter={ccFilter}
            onCCFilterChange={setCCFilter}
          />
        );
      }

      case 'excluded': {
        const sortedData = [...filteredExcludedData].sort((a, b) => {
          const dateA = parseBrDate(a.data);
          const dateB = parseBrDate(b.data);
          if (!dateA || !dateB) return 0;
          return dateB.getTime() - dateA.getTime();
        });

        return (
          <FinancialTable
            data={sortedData.map((d) => ({
              data: d.data,
              plano: d.planoFinanceiro,
              credor: d.credor,
              centroCusto: d.centroCusto,
              valor: d.valor,
            }))}
            columns={[
              { header: 'Data', accessor: 'data' },
              { header: 'Plano Financeiro', accessor: 'plano' },
              { header: 'Credor', accessor: 'credor' },
              { header: 'Centro de Custo', accessor: 'centroCusto' },
              { header: 'Valor', accessor: 'valor', format: formatCurrency },
            ]}
          />
        );
      }

      case 'excluded-chart': {
        const grouped = new Map<string, number>();
        filteredExcludedData.forEach((record) => {
          grouped.set(
            record.planoFinanceiro,
            (grouped.get(record.planoFinanceiro) || 0) + record.valor
          );
        });

        const chartValues = Array.from(grouped.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value);

        return (
          <FinancialChart
            data={chartValues}
            title={`Despesas por Plano Financeiro Excluído - ${periodText}`}
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            Dashboard Financeiro
          </h1>
          <p className="text-muted-foreground">
            Análise de Despesas por Centro de Custo
          </p>
        </header>

        <DateFilters
          startDate={startDate}
          endDate={endDate}
          includeProlabore={includeProlabore}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onIncludeProlaboreChange={setIncludeProlabore}
        />

        <SummaryPanel
          summary={isExcludedTab ? excludedSummary : operationalSummary}
          title={isExcludedTab ? 'Resumo Excluídos' : 'Resumo Operacional'}
          period={periodText}
        />

        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="mt-6">{renderTabContent()}</div>
      </div>
    </div>
  );
};

export default Index;
